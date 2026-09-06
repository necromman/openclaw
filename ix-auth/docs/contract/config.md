# 설정 계약

> **정본.** 모든 키는 `ixauth.` 접두어. 환경변수는 `IXAUTH_` + 대문자 스네이크.\
> 예: `ixauth.jwt.access-ttl` → `IXAUTH_JWT_ACCESS_TTL`

---

## 1. 필수

기동에 반드시 필요한 값. 없으면 **부팅을 중단한다** (기본값으로 조용히 뜨지 않는다).

| 키 | 환경변수 | 설명 |
|----|---------|------|
| `ixauth.db.url` | `IXAUTH_DB_URL` | 앱과 **같은 DB**. 스키마만 분리 (불변식 3) |
| `ixauth.db.username` | `IXAUTH_DB_USERNAME` | |
| `ixauth.db.password` | `IXAUTH_DB_PASSWORD` | |
| `ixauth.jwt.issuer` | `IXAUTH_JWT_ISSUER` | 토큰 `iss`. 앱 식별 URL 또는 이름 |
| `ixauth.service-key` | `IXAUTH_SERVICE_KEY` | 앱→jar 공유 시크릿. **32자 이상** |
| `ixauth.admin.email` | `IXAUTH_ADMIN_EMAIL` | 초기 관리자 (최초 부팅 시 1회 생성) |
| `ixauth.admin.password` | `IXAUTH_ADMIN_PASSWORD` | 초기 관리자 비밀번호 |

**부팅 실패 조건**: 위 항목 누락 · `service-key` 32자 미만 · DB 연결 실패 · 마이그레이션 실패.

---

## 2. 동작 모드

| 키 | 기본값 | 설명 |
|----|--------|------|
| `ixauth.mode` | `standalone` | `standalone` \| `federated` \| `hybrid` — [설계 문서](../design/embedded-auth-server-design.md) §5.7 |
| `ixauth.federated.issuer-uri` | — | `federated`/`hybrid` 일 때 IX-Trust 주소 [P4] |
| `ixauth.federated.client-id` / `.client-secret` | — | 동상 [P4] |

---

## 3. 데이터베이스

| 키 | 기본값 | 설명 |
|----|--------|------|
| `ixauth.db.schema` | `ixauth` | 스키마명. PostgreSQL 은 스키마, MariaDB/MySQL 은 같은 서버의 **별도 데이터베이스**로 동작. 마이그레이션은 `db/migration/{vendor}` 로 방언별 분리 — 세 방언 모두 실지원 |

> **MariaDB · MySQL 접속 규약** — URL 이 ixauth 데이터베이스를 **직접** 가리키게 한다:
> `jdbc:mariadb://db:3306/ixauth?createDatabaseIfNotExist=true`
> `jdbc:mysql://db:3306/ixauth?createDatabaseIfNotExist=true`
> (PostgreSQL 처럼 앱 DB 를 가리키면 스키마=카탈로그 매핑 탓에 Hibernate 검증이
> 표를 찾지 못한다. 같은 서버를 쓰므로 불변식 3(앱 DB 공유)은 그대로 성립한다.)
>
> **MySQL 은 `jdbc:mysql://` 로 붙인다** (2026-08-21). Flyway 는 JDBC URL 로 방언을 정하므로
> MySQL 8 서버에 `jdbc:mariadb://` 로 붙으면 MariaDB 용 마이그레이션이 적용되고,
> MySQL 이 금지하는 JSON 리터럴 DEFAULT 에서 부팅이 멈춘다(ERROR 1101). 드라이버는
> `mysql-connector-j` 가 함께 실려 있어 별도 설치가 필요 없다.
| `ixauth.db.pool-size` | `10` | 커넥션 풀 |
| `ixauth.db.migrate-on-start` | `true` | 부팅 시 Flyway 자동 실행. **false 로 두면 스키마 자동 구성이라는 존재 이유가 사라진다** |
| `ixauth.db.embedded` | `false` | 개발용 H2 임베디드. **운영에서 true 면 부팅 거부** |

---

## 4. 토큰 — `ixauth.jwt.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `algorithm` | `RS256` | `RS256` \| `ES256`. 근거는 [`token.md`](token.md) §2 |
| `issuer` | (필수) | `iss` |
| `audience` | `ixauth.jwt.issuer` 와 동일 | `aud` |
| `access-ttl` | `15m` | 짧게 유지 — 로컬 검증이라 즉시 무효화가 안 되는 대가를 상쇄 |
| `refresh-ttl` | `7d` | |
| `private-key` | (자동 생성) | PEM 직접 주입. 미설정 시 최초 부팅에 생성 후 DB 보관 |
| `key-rotation-days` | `90` | 자동 회전 주기. `0` 이면 회전하지 않는다 |
| `clock-skew` | `60s` | 검증 허용 오차 |

### 자동 회전 (2026-08-08 구현 · G19)

매일 새벽 배치가 현재 키의 나이를 본다. `key-rotation-days` 를 넘었으면 새 키를 발급하고 구 키는 **비활성으로만** 바꾼다.

- **구 키를 즉시 버리지 않는다.** 그 키로 서명된 access token 이 아직 유효하기 때문이다. JWKS 에는 둘 다 실린다
- 구 키를 내리는 것은 **현재 키가 `access-ttl + clock-skew` 보다 오래된 뒤**다. 그 시점이면 구 키로 서명된 토큰은 모두 만료됐다 (키마다 '언제 물러났는가' 를 따로 저장하지 않아도 이 한 가지로 판정이 선다)
- 회전과 내리기는 **감사 로그에 남는다** (`SIGNING_KEY_ROTATED` · `SIGNING_KEY_RETIRED`). "언제부터 이 kid 로 서명됐는가" 를 나중에 반드시 묻게 된다
- `private-key` 로 키를 직접 주입한 설치에서는 **회전하지 않는다** — 주입한 쪽의 의도가 "이 키를 쓴다" 이기 때문이다

---

## 5. 비밀번호 정책 — `ixauth.password.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `encoder` | `bcrypt` | `bcrypt` \| `argon2`. 저장 시 `{bcrypt}` 접두어가 붙는다 |
| `bcrypt-strength` | `10` | |
| `min-length` | `10` | |
| `require-uppercase` | `true` | |
| `require-digit` | `true` | |
| `require-special` | `true` | |
| `rehash-on-login` | `true` | 레거시 해시를 로그인 성공 시 현행 알고리즘으로 조용히 재해싱. **개발 중 프로젝트 이사(도입 케이스 B)의 핵심** |
| `history-count` | `0` | **최근 N개 재사용 금지.** `0` = 이력을 검사하지 않는다. 2026-08-08 추가 |
| `check-breached` | `false` | 외부 유출 목록(HIBP) 대조. 2026-08-08 추가 |

### 재사용 이력 — 기본이 `0` 인 이유

이력을 남기려면 **지난 비밀번호의 해시를 계속 보관**해야 한다. 그건 보관하는 개인정보를 늘리는 일이라, 요구받지 않는 곳에서 켤 이유가 없다. 공공·금융에서 흔히 3~5 를 요구한다.

- `0` 이어도 **직전** 비밀번호는 언제나 막는다 (`AUTH_PASSWORD_REUSED`). 현재 해시와의 비교라 따로 보관하는 것이 없다
- 적용 지점: **본인 비밀번호 변경**과 **토큰 재설정**. 관리자 초기화(`/admin/users/{id}/password-reset`)는 **검사하지 않고 기록만 한다** — 이력에 있으면 거부한다고 답하는 순간 그 API 가 "그 사람이 전에 이 비밀번호를 썼는가" 를 확인하는 도구가 된다
- 재설정 흐름에서 이력 위반은 **토큰을 소모하지 않는다.** 정책 위반과 같은 이유다 ([`http-api.md`](http-api.md) §2-1)
- 켜기 **전에** 쓰던 비밀번호는 이력에 없어 걸리지 않는다. 없는 것을 소급해서 만들 수는 없다
- `0` 으로 되돌리면 다음 비밀번호 변경 때 그 사용자의 이력이 **삭제된다** — 검사에 쓰지 않을 해시를 들고 있지 않는다

### 유출 비밀번호 차단 — k-익명성

보내는 것은 SHA-1 해시의 **앞 5자**뿐이고, 그 5자로 시작하는 해시 접미사 수백 개를 받아 **대조는 이쪽에서** 한다. 비밀번호도, 온전한 해시도 밖으로 나가지 않는다.

```
비밀번호 → SHA-1 → 21BD1…0A9B7      GET https://api.pwnedpasswords.com/range/21BD1
                    ─────  앞 5자만    ← 접미사:노출횟수 목록 → 나머지 35자를 로컬에서 찾는다
```

- **기본이 `false` 인 이유는 외부 API 이기 때문이다.** 폐쇄망 설치에서는 조회 자체가 되지 않는다
- **조회 실패는 가입·변경을 막지 않는다(fail-open).** WARN 로그만 남는다 — 남의 서비스 장애가 우리 로그인 장애가 되면 안 된다
- 타임아웃 3초. 설정으로 빼지 않았다 — fail-open 이라 늘려 봐야 "더 오래 기다렸다가 통과" 다
- 형식 검사를 **모두 통과한 뒤에만** 부른다. 어차피 거절될 비밀번호로 외부를 두드리지 않는다
- 여기서 쓰는 SHA-1 은 **저장이 아니라 조회 키**다. 비밀번호 저장은 그대로 bcrypt 다

---

## 5-0. 런타임 설정 — yml 은 기본값, DB 가 덮어쓴다

관리자가 화면(`/admin-ui` → **설정**)에서 바꾸면 **재시작 없이** 반영된다.

| | 어디에 | 언제 쓰나 |
|---|--------|----------|
| yml · 환경변수 | 배포 산출물 | 기본값. 처음 띄울 때의 상태 |
| `ixauth.settings` 표 | 앱 DB | 관리자가 바꾼 값. 행이 없으면 yml 값 |

행이 없으면 yml 을 쓰므로, **새 설정을 추가해도 기존 DB 에 아무 작업이 필요 없다.**

### 화면에 나오는 것과 안 나오는 것

관리 화면은 `SettingDefinitions` 에 등록된 것만 보여 준다. **시크릿은 의도적으로 빠져 있다.**

| 화면에서 바꿀 수 있다 | 환경변수로만 |
|---------------------|-------------|
| 가입 방식·본인확인·도메인 제한 | `service-key` |
| 잠금·속도 제한 | 소셜 `client-secret` |
| 링크 수명·재발송 간격 | SMTP 비밀번호 |
| 메일 앱 주소·제품명 | DB 접속 정보 |
| 감사 보존 기간 | 2단계 인증 시크릿 암호화 키 |
| 2단계 인증 요구 범위·백업 코드 수 | **CAPTCHA `secret-key`** |
| 약관 사용·재동의 요구 | **소셜 provider 별 `enabled`·키** |
| 비밀번호 재사용 이력 수·유출 목록 대조 | |
| 속성 엄격 검사·일괄 등록 상한 | |
| 메일 재시도·이력 보존·기본 언어 | |
| 감사 CSV 상한·속도 제한 저장소·키 회전 주기 | |
| **매직 링크 사용·링크 수명·앱 경로** | |
| **CAPTCHA 사용·제공자·점수 하한·걸 경로** | |
| **step-up 재인증 대상 작업** | |

시크릿을 화면에서 편집 가능하게 만들면 DB·감사로그·백업으로 유출면이 넓어지고, **관리자 계정 하나가 뚫리면 전부 새어 나간다.** 편의보다 이쪽이 중요하다.

### 지켜지는 것

- **잘못된 값은 저장되지 않는다** — 적용해 본 뒤 저장하므로 DB 에 쓰레기가 남지 않고, 실패해도 기존 값이 유지된다
- **정의에 없는 키는 거부** — 오타가 조용히 묻혀 "설정했는데 안 먹는다" 가 되는 것을 막는다
- **누가 무엇을 무엇으로 바꿨는지** 감사 로그에 남는다 (`SETTING_CHANGED`)
- 기간은 `30m` · `2h` · `7d` 로 쓴다 (화면에 `PT30M` 을 적게 하지 않는다)

⚠ **다중 인스턴스** — A 에서 바꾸면 B 는 최대 1분 뒤에 따라잡는다(폴링). 전용 Redis·메시지 버스를 두지 않는 것이 설계 불변식 3 이므로, 그 사이의 불일치가 치명적인 설정은 두지 않는다.

---

## 5-1. 메일 — `ixauth.mail.*`

비밀번호 찾기·이메일 인증·초대가 사용자에게 닿는 통로다. **발송은 jar 가 한다** — 앱에 떠넘기면 프로젝트마다 템플릿과 발송 코드를 또 만들게 되고, 이 제품이 없애려던 수고가 재발한다.

| 키 | 기본값 | 설명 |
|----|--------|------|
| `transport` | `LOG` | `SMTP` · `WEBHOOK` · `LOG` |
| `from` | `no-reply@localhost` | 보내는 사람. `IX-Auth <no-reply@example.com>` 형식 가능 |
| `app-base-url` | (없음) | **필수.** 메일 링크가 가리킬 **앱** 주소. jar 주소가 아니다 |
| `reset-path` | `/reset-password` | 앱의 재설정 화면 경로 |
| `verify-path` | `/verify-email` | 앱의 인증 화면 경로 |
| `invite-path` | `/accept-invite` | 앱의 초대 수락 화면 경로 |
| `magic-link-path` | `/magic-link` | 앱의 로그인 링크 화면 경로. 2026-08-08 추가 |
| `product-name` | `IX-Auth` | 메일 제목·본문에 쓴다 |
| `smtp.host` `smtp.port` | — · `587` | |
| `smtp.username` `smtp.password` | — | 비우면 인증 없이 보낸다 |
| `smtp.starttls` `smtp.ssl` | `true` · `false` | |
| `smtp.timeout` | `10s` | 없으면 SMTP 무응답 시 요청 스레드가 묶인다 |
| `webhook.url` | — | jar 가 여기로 POST 한다 |
| `webhook.send-service-key` | `true` | 앱이 출처를 확인할 수 있게 |
| `retry-enabled` | `true` | 발송 실패 시 지수 백오프로 최대 3회 |
| `retention-days` | `30` | 발송 이력 보존. `0` 이면 무기한 |
| `default-locale` | `ko` | 사용자 속성 `locale` 이 없을 때 쓸 언어 (`ko` · `en`) |

**`LOG` 가 기본인 이유** — SMTP 설정 없이도 개발자가 재설정 흐름을 끝까지 눌러 볼 수 있어야 한다. 로그에 뜬 링크를 브라우저에 붙이면 된다. 운영에서 이 모드로 뜨면 아무도 메일을 받지 못하므로 부팅 시 경고가 나간다.

**웹훅으로 넘어가는 형태** — 사내 메일 시스템을 쓰거나 폐쇄망이라 SMTP 를 열 수 없을 때:

```
POST {webhook.url}
X-IxAuth-Key: …
{ "to": "…", "kind": "PASSWORD_RESET", "link": "https://앱/reset-password?token=…",
  "subject": "…", "body": "…", "locale": "ko",
  "vars": { "name": "…", "productName": "…", "expiresIn": "30분", "link": "…" } }
```

`kind` 는 `PASSWORD_RESET` · `EMAIL_VERIFY` · `INVITE` · `EMAIL_CHANGE` · `PASSWORD_CHANGED` · `ACCOUNT_EXISTS` · `SIGNUP_APPROVED` · `NEW_DEVICE_LOGIN` · `ACCOUNT_DELETE_REQUESTED` · `ACCOUNT_DELETED` · `MFA_RESET` · `MAGIC_LINK`(2026-08-08 추가). **기존 값을 지우거나 이름을 바꾸지 않는다 — 받는 앱이 이 문자열로 분기한다.**

⚠ **`MAGIC_LINK` 의 `link` 는 그 자체가 로그인이다.** 이것을 받는 앱은 다른 종류보다 조심해서 다뤄야 한다 — 링크를 로그·모니터링·에러 리포트에 남기면 그것을 볼 수 있는 사람이 남의 계정으로 들어올 수 있다. 뒤 넷은 링크가 없어 `link` 가 `null` 이고, `NEW_DEVICE_LOGIN` 은 `vars` 에 `at`·`ip`·`device` 가 더 온다. 앱은 `body` 를 버리고 `link` 만 가져다 자기 템플릿으로 다시 만들어도 된다 — 본문에서 URL 을 파싱하게 두면 템플릿을 바꾸는 순간 앱이 깨지므로 `link` 를 따로 준다.

**발송 실패는 요청을 실패시키지 않는다.** 재설정 응답은 계정 존재 여부를 감춰야 하는데, 그 응답이 SMTP 상태에 따라 갈리면 감추는 의미가 없다.

### 발송 이력과 재시도 — `mail.retry-enabled` · `mail.retention-days`

> 2026-08-08 추가 (G21). 조회 API 는 [`http-api.md`](http-api.md) §4.

예전에는 실패를 삼키고 로그에만 남겼다 — **운영자가 "안 갔다" 를 알 방법이 없었다.** 이제 발송마다 `ixauth.mail_deliveries` 에 한 줄이 남는다.

| 상태 | 뜻 |
|------|-----|
| `SENT` | 통로가 받아 갔다 |
| `FAILED` | 실패했고 재시도가 남아 있다 |
| `GAVE_UP` | 재시도를 다 썼다. **운영자가 손대야 하는 것은 이것이다** |
| `SKIPPED` | `transport=LOG` 라 실제로 나가지 않았다 |
| `PENDING` | 아직 첫 시도 전 |

`SKIPPED` 를 `SENT` 로 적지 않는 이유 — 운영자는 그것을 "사용자가 받았다" 로 읽는다. 그 거짓말은 "왜 안 왔지" 를 조사하는 시간을 통째로 낭비시킨다.

**본문과 링크는 저장하지 않는다.** 재설정 링크가 DB(와 그 백업)에 남으면 그것을 읽을 수 있는 사람이 누구의 계정이든 가져갈 수 있다 — 이력이 주는 편의보다 훨씬 비싸다. 남는 것은 *받는 사람 · 용도 · 제목 · 언어 · 상태 · 시도 횟수 · 마지막 오류* 뿐이다.

그 대가로 **재시도는 발송 시점의 메시지를 메모리에 들고 있는 동안만** 된다. 프로세스가 내려가면 대기 중이던 재시도는 사라지고 이력에는 실패로 남는다 — 그때는 해당 기능(초대·재설정)을 다시 실행한다. 관리 화면의 재시도 버튼도 메시지를 아직 들고 있는 행에서만 눌린다(응답의 `retryable`).

재시도는 1분 → 2분 간격으로 최대 3회(최초 1회 포함)다. 보존 기간이 지난 이력은 매일 새벽에 지운다 — 받는 사람 주소가 들어 있어 무한정 쌓아 둘 이유가 없다.

### 템플릿과 다국어 — `mail.default-locale`

> 2026-08-08 추가 (G16 · G17). 편집 API 는 [`http-api.md`](http-api.md) §4.

**고치지 않으면 코드의 기본 템플릿이 쓰인다.** 설정 표와 같은 방식이라(§5-0), 이 기능이 생겼다고 이미 운영 중인 설치의 메일 문구가 한 글자도 달라지지 않는다. 편집은 `ixauth.mail_templates` 에 덮어쓰기이고, 삭제가 곧 초기화다.

자리표시자는 `{name}` · `{link}` · `{productName}` · `{expiresIn}` 이고, 새 기기 알림은 `{at}` · `{ip}` · `{device}`, 초대는 `{inviter}` 를 더 쓴다. **모르는 이름은 지우지 않고 그대로 남긴다** — 지우면 `{nmae}` 같은 오타가 글자만 사라져 원인을 찾을 수 없다.

언어를 고르는 순서:

1. 사용자 속성 `locale` (`ko-KR` · `KO` 는 `ko` 로 본다)
2. `mail.default-locale`
3. 그 언어의 템플릿이 없으면 기본 언어의 것 → 그래도 없으면 `ko`

기본 템플릿은 `ko`·`en` 두 벌만 코드에 있다. 그 이상은 품질을 보증할 수 없어서이고, 다른 언어는 관리자가 템플릿을 넣으면 된다. **메일이 안 나가는 것보다 다른 언어로라도 나가는 편이 낫다** — 링크를 받지 못하면 사용자는 계정을 되찾을 수 없다.

---

## 5-2. 계정 — `ixauth.account.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `signup-mode` | `OPEN` | `CLOSED`(초대 전용) · `OPEN`(즉시 가입) · `APPROVAL`(승인제).
⚠ **기본이 열려 있다** — 사내용으로 띄운다면 `CLOSED` 로 바꾸거나 `signup-allowed-domains` 를 함께 건다. 그러지 않으면 주소를 아는 누구나 계정을 만든다 |
| `signup-verification` | `EMAIL` | `NONE` · `EMAIL` · `PASS`. PASS 는 별도 연동이 있어야 하고, 없으면 가입이 실패한다 |
| ~~`signup-enabled`~~ | — | **폐지.** `signup-mode` 로 대체. 남아 있으면 부팅 시 `true`→`OPEN` 으로 해석하고 경고한다 |
| `signup-allowed-domains` | (없음) | 가입 허용 도메인. 비우면 제한 없음 |
| `require-email-verification` | `false` | 인증을 마쳐야 로그인. 미인증이면 `AUTH_EMAIL_UNVERIFIED` |
| `reset-token-ttl` | `30m` | 길수록 메일함 유출 시의 창이 넓어진다 |
| `verify-token-ttl` | `1d` | |
| `invite-token-ttl` | `7d` | |
| `revoke-sessions-on-password-change` | `true` | 비밀번호를 바꾸는 목적은 대개 "누가 내 계정을 쓰는 것 같다" 다. 세션을 남기면 그 목적이 달성되지 않는다 |
| `resend-cooldown` | `1m` | 없으면 남의 주소로 메일을 무한히 보낼 수 있다 |
| `notify-new-device` | `true` | 새 기기·새 IP 로그인 시 본인에게 메일. 2026-08-08 추가 |
| `max-concurrent-sessions` | `0` | 계정당 동시 활성 세션 상한. `0` = 제한 없음. 초과하면 **가장 오래된 것부터** 폐기 |
| `self-delete-mode` | `DISABLED` | 본인 탈퇴 — `DISABLED` · `IMMEDIATE`(즉시 비활성) · `GRACE`(유예 후) |
| `self-delete-grace` | `7d` | `GRACE` 일 때의 유예 기간. 그 사이 **로그인하면 취소**된다 |
| `strict-attributes` | `false` | `users.attributes` 에 **정의에 없는 키**를 거부. 2026-08-08 추가 |
| `bulk-import-max` | `500` | 일괄 등록 1회 상한(행). 초과하면 **요청 전체를 거절**한다. 2026-08-08 추가 |
| `magic-link-enabled` | `false` | 비밀번호 없이 메일 링크로 로그인 ([`http-api.md`](http-api.md) §2-5). 2026-08-08 추가 |
| `magic-link-token-ttl` | `10m` | 링크 수명. **재설정 링크(30분)보다 짧다** — 링크 자체가 로그인이라 노출 창을 좁힌다 |

⚠ `magic-link-enabled` 를 켜면 **메일함이 곧 로그인 수단**이 된다. 비밀번호를 아무리 길게 걸어 두어도 그 계정의 실질 보안 수준은 메일함의 보안 수준을 넘지 못한다. 사내 메일이 이미 SSO 뒤에 있는 곳에서는 합리적인 선택이지만, 그 판단은 운영자가 한다. **2단계를 켠 계정은 이 경로로도 코드를 한 번 더 받는다** — 소셜 로그인과 갈리는 지점이고 근거는 [`http-api.md`](http-api.md) §2-5.

⚠ `strict-attributes` 는 **이미 저장된 데이터를 소급해서 불법으로 만든다.** 정의 기능이 없던 시절에 앱이 자유롭게 넣어 둔 키가 그대로 남아 있고, 켜는 순간 그 사용자를 수정하는 요청이 전부 400 이 된다. 쓰이는 키를 모두 정의에 등록한 뒤 켠다. 정의가 하나도 없으면 이 값과 무관하게 **아무 검사도 하지 않는다**.

⚠ `require-email-verification` 을 켤 때 — 기존 계정은 V2 마이그레이션에서 인증된 것으로 표시된다. 그렇지 않으면 켜는 순간 **전원이 로그인하지 못한다**.

### 이 셋의 기본값이 "가장 닫힌 값" 이 아닌 이유

기본값은 안전한 쪽으로 둔다는 규칙(§12-3)에 예외를 셋 두었다. 근거를 남긴다.

| 키 | 기본값 | 왜 |
|----|--------|-----|
| `notify-new-device` | `true` | 알림은 **보내는 쪽**이 안전하다. 계정을 빼앗겼다는 사실을 사용자가 스스로 알아챌 통로가 사실상 이것뿐이다 (세션 목록은 들여다봐야 보인다) |
| `max-concurrent-sessions` | `0` | 제한을 기본으로 걸면 PC·휴대폰·태블릿을 함께 쓰는 사람이 **영문도 모르고 로그아웃**된다. 보안이 아니라 장애로 체감된다 |
| `mfa.admin-reset` | `true` | 아래 §5-4 참조 |

### 본인 탈퇴 — 물리 삭제하지 않는다

어느 모드든 행을 **지우지 않는다.** `status=DISABLED` + `users.deletion_requested_at`(V7) 기록이다.

- 지우면 감사 로그의 `user_id` 가 가리킬 곳이 사라져 "누가 무엇을 했는지" 를 되짚을 수 없다
- 같은 주소로 다시 가입해 자기 이력을 지울 수 있다 — 정지·거절당한 사람의 세탁 경로가 된다

| 모드 | 요청 즉시 | 그 뒤 |
|------|----------|-------|
| `IMMEDIATE` | `status=DISABLED` · 전 세션 폐기 · 완료 메일 | 되돌릴 수 없다. 관리자가 상태를 되돌려야 한다 |
| `GRACE` | 요청 시각 기록 · 전 세션 폐기 · 접수 메일(비활성 예정 시각 포함) | 유예 안에 **로그인 한 번**으로 취소. 유예가 지나면 야간 배치(04:50)가 비활성으로 바꾼다 |

취소 링크를 따로 만들지 않는다 — 그 링크가 담긴 메일함을 쥔 쪽이 탈퇴를 되돌릴 수 있으면 안 되고, 취소에 결정을 한 번 더 요구하면 홧김에 누른 사람을 돌려세우지 못한다.

⚠ 이미 요청해 둔 상태에서 다시 요청해도 **유예 시작 시각은 갱신되지 않는다.** 누를 때마다 밀리면 유예가 영영 끝나지 않는다.

⚠ 모드를 `GRACE` 에서 다른 값으로 바꾸면 **남아 있던 요청은 집행되지 않는다.** 기능을 끈 뒤에 계정이 조용히 닫히면 아무도 원인을 알 수 없다.

---

## 5-3. 소셜 로그인 — `ixauth.social.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `enabled` | `false` | |
| `auto-signup` | `false` | 처음 보는 외부 계정을 자동 생성. **켜면 그 provider 계정을 가진 누구나 들어온다** |
| `auto-link-verified-email` | `true` | 같은 이메일의 기존 계정에 자동 연결. **provider 가 검증했다고 명시한 경우에만** 적용된다 |
| `state-ttl` | `10m` | 사용자가 provider 화면에 머무는 시간을 감안 |
| `<provider>.enabled` | `false` | `microsoft` · `kakao` · `naver` · **`google`**(2026-08-08 추가) |
| `<provider>.client-id` / `client-secret` | — | secret 은 로그·응답에 싣지 않는다 |
| `microsoft.tenant` | `common` | **사내용이면 자기 테넌트 ID 를 넣는다.** `common` 은 아무 MS 계정이나 통과시킨다 |
| `<provider>.trust-email-verified` | `true` | provider 의 "검증됨" 신호를 믿을지. 네이버는 신호 자체가 없어 무의미 |

`client-id` 가 비어 있으면 켜도 목록에 나오지 않는다 — 눌렀을 때 provider 화면에서 실패하는 것보다 버튼이 없는 편이 낫다.

**provider 를 화면에서 켜고 끄지 않는 이유** — 켜려면 `client-secret` 이 함께 있어야 하는데 그건 시크릿이라 화면에서 다루지 않는다(규칙 3). 키는 환경변수에, 스위치도 그 옆에 두는 편이 "켰는데 왜 안 되지" 를 줄인다. 화면에는 전체 스위치(`social.enabled`)와 매칭 정책 둘만 있다.

### Google (2026-08-08 추가)

```yaml
ixauth:
  social:
    google:
      enabled: true
      client-id: ${GOOGLE_CLIENT_ID}          # …apps.googleusercontent.com
      client-secret: ${GOOGLE_CLIENT_SECRET}
```

- **이메일 검증 신호를 규격으로 준다** (`email_verified`, OIDC 표준 클레임). 넷 중 가장 믿을 수 있는 신호이고, 자동 연결(②)이 그대로 성립한다
- **PKCE(S256)를 쓴다** — Microsoft 와 같다
- ⚠ **범위를 좁히는 수단이 없다.** Microsoft 의 테넌트에 해당하는 것이 없어서, 켜면 Google 계정을 가진 누구나 동의 화면을 통과한다. 사내 시스템이라면 `social.auto-signup: false` 로 두고 초대받은 계정에만 붙게 하거나, `account.signup-allowed-domains` 로 도메인을 건다. Google 의 `hd` 파라미터는 **힌트일 뿐 강제가 아니므로** 그것에 기대지 않는다
- 콘솔 등록 절차는 [`docs/guides/social-login.md`](../guides/social-login.md) §1-4

---

## 5-4. 2단계 인증 — `ixauth.mfa.*`

> 2026-08-08 추가 (TOTP · 백업 코드).

| 키 | 기본값 | 설명 |
|----|--------|------|
| `mode` | `OPTIONAL` | `OPTIONAL`(사용자 선택) · `REQUIRED_ADMIN`(관리 권한자 필수) · `REQUIRED_ALL`(전원 필수) |
| `backup-code-count` | `10` | 등록 시 한 번만 보여 주는 1회용 코드 수. **0 으로 두지 않는다** — 휴대폰 분실 시의 유일한 출구다 |
| `issuer` | (비움) | 인증 앱 목록에 표시될 이름. 비우면 `mail.product-name` |
| `challenge-ttl` | `5m` | 비밀번호 통과 후 코드를 넣기까지의 제한 시간 |
| `admin-reset` | `true` | 관리자가 남의 2단계를 초기화할 수 있는가 (`POST /admin/users/{id}/mfa-reset`). 2026-08-08 추가 |
| `step-up-actions` | (비움) | 민감 작업에 코드를 한 번 더 요구한다 — `PASSWORD_CHANGE` · `EMAIL_CHANGE` · `ACCOUNT_DELETE` · `MFA_DISABLE`. 2026-08-08 추가 |
| `encryption-key` | (비움) | **시크릿 — 환경변수로만** (`IXAUTH_MFA_ENCRYPTION_KEY`). 화면에 노출하지 않는다 |

### step-up 재인증 — 비밀번호만으로는 답할 수 없는 질문

이 넷은 이미 **현재 비밀번호**를 요구한다. 그런데 비밀번호는 **한 번 새면 계속 새어 있는** 값이라 "이 사람이 비밀번호를 안다" 만 증명하고, **"지금 이 사람이 계정 주인이다" 는 증명하지 못한다.** 30초마다 바뀌는 TOTP 코드는 그 질문에 답한다 — 훔친 비밀번호로 들어온 쪽은 **이메일을 바꿔 계정을 통째로 가져가는 마지막 한 걸음**에서 막힌다.

| | 왜 이 값이 기본인가 |
|---|-------------------|
| 비어 있음 | 켜면 앱이 그 화면에서 `mfaCode` 를 받아 보내도록 **먼저 고쳐야** 한다. 고치기 전에 켜면 2단계를 켠 사용자의 그 화면들이 전부 실패한다 |

- **2단계를 켜지 않은 계정에는 적용되지 않는다.** 요구할 코드 자체가 없고, 막으면 그 사람은 비밀번호조차 바꿀 수 없게 된다 — 보안이 아니라 장애다. 전원에게 강제하려면 `mfa.mode = REQUIRED_ALL` 이 그 수단이다
- 백업 코드도 받는다. 휴대폰을 잃었다고 민감 작업이 영영 막히면 안 된다
- **유효 시간(grace)을 두지 않는다.** "5분 안에는 다시 묻지 않는다" 를 만들면 그 사이 이메일 변경이 코드 없이 통과한다
- 넷 중 `MFA_DISABLE` 이 가장 중요하다. 2단계를 끄는 것을 막지 못하면 나머지 셋을 걸어 둔 의미가 사라진다 — 공격자는 2단계부터 끄고 시작한다
- 계약·응답 형식은 [`http-api.md`](http-api.md) §2-6

**`admin-reset` 기본값이 `true` 인 이유.** 끄는 쪽이 더 닫힌 값이지만, 끄면 휴대폰과 백업 코드를 **모두** 잃은 사람의 복구 경로가 **DB 직접 수정**밖에 남지 않는다 — 그쪽은 감사 로그도 통지도 없어 오히려 위험하다. 그리고 `ixauth:users:write` 를 가진 사람은 이미 그 계정의 비밀번호를 초기화할 수 있으므로, 이 스위치를 꺼도 막히는 것이 많지 않다.

실제 통제 수단은 스위치가 아니라 초기화에 **항상 따라붙는 두 가지**다. 이 둘은 설정으로 끌 수 없다.

- 감사 로그 `MFA_RESET_BY_ADMIN` (누가 · 누구를 · 언제)
- 대상자에게 나가는 **통지 메일**

관리자가 조용히 남의 2단계를 끄고 그 계정으로 들어가는 일이 없어야 한다.

알고리즘 파라미터(SHA-1 · 30초 · 6자리 · 오차 ±1스텝)는 **설정에 없다.** 고객사마다 다를 수 있는 정책이 아니라 인증 앱과 맞아야 하는 규격이고, 바꾸면 대부분의 앱이 코드를 만들지 못한다.

⚠ **`encryption-key` 를 비우면 `service-key` 에서 파생한다.** 그 경우 **service-key 를 교체하는 순간 등록된 TOTP 가 전부 무효**가 되고, 사용자는 백업 코드로 들어와 다시 등록해야 한다. 운영에서는 따로 준다.

⚠ **`REQUIRED_*` 로 바꿔도 기존 사용자는 잠기지 않는다.** 아직 등록하지 않은 사람의 로그인은 그대로 성공하고, 응답에 `mfaSetupRequired: true` 가 실린다 ([`http-api.md`](http-api.md) §2-3). 막지 않는 이유는 막으면 설정을 바꾼 순간 전원이 잠기기 때문이고, 앱이 토큰을 로컬 검증하는 구조(설계 불변식 2)에서는 "제한된 토큰" 도 결국 앱이 강제해야 하기 때문이다. **앱이 그 신호를 받아 등록 화면으로 보내야 실제로 강제된다.**

소셜 로그인은 이 요구를 적용하지 않는다 — provider 가 이미 본인확인을 마친 경로다.

---

## 5-5. 약관 — `ixauth.terms.*`

> 2026-08-08 추가.

| 키 | 기본값 | 설명 |
|----|--------|------|
| `enabled` | `false` | 약관 기능 전체 스위치. 끄면 조회·동의 API 가 빈 결과를 주고 재동의 신호도 나가지 않는다 |
| `require-on-signup` | `true` | 가입 요청에 필수 약관 동의가 없으면 `AUTH_TERMS_REQUIRED`(400) |
| `reagreement-required` | `true` | 필수 약관이 새 버전으로 게시되면 다시 받는다 |

**기본이 꺼짐인 이유** — 대외 서비스에는 사실상 필수이고 **사내 인스턴스에는 받을 약관 자체가 없다.** 같은 jar 하나로 둘 다 덮으려면 기능 전체가 스위치여야 한다.

**꺼도 등록해 둔 약관과 동의 이력은 지우지 않는다.** 기능을 잠시 껐다고 법적 증빙이 사라지면 안 된다.

### 재동의는 로그인을 막지 않는다

`reagreement-required` 가 켜져 있어도 **로그인은 그대로 성공한다.** 응답에 `termsAgreementRequired: ["service", …]` 가 실리고, 앱이 그 신호를 받아 동의 화면으로 보내야 실제로 강제된다 — 2단계 인증의 `mfaSetupRequired` 와 **같은 방식이고 같은 이유**다. 막으면 새 버전을 게시하는 순간 전원이 못 들어온다.

소셜 로그인에도 **똑같이 나간다.** 2단계 인증과 다른 점이다 — 2단계는 provider 가 본인확인을 대신했다고 볼 수 있지만, 약관은 우리와 사용자 사이의 합의라 provider 가 대신 받아 줄 수 있는 것이 아니다.

### 버전과 증빙

- 약관은 `(코드, 버전)` 으로 식별한다. 개정하면 **행을 고치지 않고 새 버전**을 만든다. 고치면 이미 동의한 사람의 이력이 가리키는 내용이 달라져 증빙이 아니게 된다
- 그래서 **게시된 약관은 내용을 수정할 수 없다** (표시 순서만). 시도하면 `CONFLICT`(409)
- 동의 이력은 **지우지도 고치지도 않는다.** 철회는 덮어쓰기가 아니라 `agreed = false` 인 새 행이다 — "언제부터 언제까지 동의 상태였는가" 가 곧 증빙이다
- 동의 이력이 붙은 약관은 **삭제되지 않는다**(409). 삭제는 오타 난 초안을 치우는 용도다
- 동의 시각·IP·User-Agent·약관 버전을 함께 남긴다

⚠ `reagreement-required` 를 끄면 옛 버전에만 동의한 사용자가 그대로 남는다. 개정된 내용에 동의받은 적이 없다는 뜻이라, 그 상태로는 증빙이 되지 않는다.

---

## 5-6. CAPTCHA — `ixauth.captcha.*`

> 2026-08-08 추가.

| 키 | 기본값 | 설명 |
|----|--------|------|
| `enabled` | `false` | 전체 스위치 |
| `provider` | `RECAPTCHA` | `RECAPTCHA`(Google reCAPTCHA v3) · `NONE`(검증 안 함) |
| `secret-key` | (비움) | **시크릿 — 환경변수로만** (`IXAUTH_CAPTCHA_SECRET_KEY`). 화면에 없다 |
| `min-score` | `0.5` | v3 의 점수 하한(0.0~1.0). 이보다 낮으면 봇으로 본다 |
| `protect` | `SIGNUP, PASSWORD_FORGOT` | 확인을 걸 경로. `SIGNUP` · `LOGIN` · `PASSWORD_FORGOT` 다중 선택 |

### 속도 제한이 있는데 왜 또 필요한가

속도 제한(§9)은 **한 출처의 속도**를 누른다. 그런데 실제 무차별 대입은 봇넷에서 온다 — 수천 IP 가 각각 한 번씩 던지면 어느 IP 도 분당 한도를 넘지 않은 채 전부 통과한다. 계정 잠금(§6)도 계정당이라 password spraying 을 막지 못한다. **대체가 아니라 셋이 서로 다른 것을 막는다.**

| 장치 | 막는 것 |
|------|--------|
| 계정 잠금 | 한 계정에 여러 비밀번호 |
| 속도 제한 | 한 출처의 빠른 반복 |
| CAPTCHA | **분산된 자동화** — 위 둘이 못 보는 축 |

### 실패는 거부, 미도달은 통과

| 상황 | 결과 |
|------|------|
| `captchaToken` 이 오지 않았다 | `AUTH_CAPTCHA_REQUIRED`(400) |
| provider 가 "봇" 이라고 답했다 | `AUTH_CAPTCHA_FAILED`(403) — **fail-closed** |
| provider 에 닿지 못했다 (타임아웃 3초·키 미설정·구현 없는 provider) | **통과** + WARN 로그 — **fail-open** |

**이 비대칭이 이 기능의 핵심 결정이다.** 판정 실패는 provider 가 정상적으로 답한 결과이므로 통과시키면 기능이 있으나 마나다. 반면 못 물어본 것은 봇이라는 증거가 아니고, 거기서 막으면 **Google 장애가 우리 가입 장애**가 된다 — 남의 서비스 가용성에 우리 로그인을 묶는 셈이다. 유출 비밀번호 검사(§5)와 같은 판단이다.

조용히 통과하지 않고 WARN 을 남기는 이유는, 안 그러면 검증이 몇 주째 죽어 있어도 아무도 모르기 때문이다.

⚠ **켜는 순서가 있다.** 앱이 요청 본문에 `captchaToken` 을 실어 보내도록 먼저 고치고, 그다음 켠다. 반대로 하면 `protect` 에 든 경로가 전부 400 이 된다.

⚠ **`protect` 기본값에 `LOGIN` 이 없다.** 가입·비밀번호 찾기가 막히면 새 사용자만 불편하지만, 로그인이 막히면 **이미 쓰고 있는 전원**이 못 들어온다. 외부 스크립트 하나에 로그인을 걸어 두는 것은 그만큼 무거운 결정이라 운영자가 명시적으로 골라야 한다.

⚠ **`provider: NONE` 은 켜 두어도 아무것도 막지 않는다.** 끄고 싶으면 `enabled` 를 끄는 편이 오해가 없다. `NONE` 은 연동을 잠시 떼어 둘 때만 쓴다.

관리 화면 로그인(`/admin-ui/api/login`)에는 걸리지 않는다 — 그 화면은 우리가 만든 정적 페이지라 site key 를 심는 것이 별도 작업이고, 애초에 외부에 노출하지 않는 것이 전제다.

---

## 5-7. 사용자 대리 — `ixauth.impersonation.*`

> 2026-08-20 추가. 계약은 [`http-api.md`](http-api.md) §4 · [`token.md`](token.md) §3.

| 키 | 기본값 | 설명 |
|----|--------|------|
| `enabled` | `true` | 전체 스위치. 끄면 `IMPERSONATION_DISABLED`(403) |
| `ttl` | `1h` | 대리 세션의 수명. 일반 로그인(`jwt.refresh-ttl`, 기본 7일)보다 짧다 |

### 기본값이 "켬" 인 이유

끄는 쪽이 더 닫힌 값이지만, 끄면 "저는 그 화면이 안 나와요" 를 재현할 남는 수단이 **그 사람의 비밀번호를 초기화하고 로그인해 보는 것**뿐이다. 그건 사용자를 실제로 쫓아내고, 감사 로그에 **본인 로그인**으로 남는다 — 흔적이 오히려 흐려진다. 2단계 관리자 초기화(§5-4 `mfa.admin-reset`)와 같은 판단이다.

실제 통제는 이 스위치가 아니라 다음 셋이고, **셋 다 설정으로 끌 수 없다.**

| | |
|---|---|
| 전용 권한 `ixauth:impersonation:create` | `ixauth:users:write` 로는 대리할 수 없다. `ixauth:users:*` 에도 딸려 가지 않는다 |
| 감사 로그 `IMPERSONATION_STARTED` | 누가·누구를·언제·어디서 |
| 민감 작업 차단 | 대리 세션은 관리 API·비밀번호/이메일 변경·탈퇴·2단계·소셜 연결·약관 동의·세션 해지를 할 수 없다 |

### `ttl` — 왜 7일이 아닌가

대리는 **지금 이 문의를 보는 동안**의 일이다. 7일을 주면 관리자 브라우저에 남의 계정으로 들어가는 열쇠가 일주일 남고, 그 사이의 조작은 전부 그 사람 이름으로 기록된다.

- access token 수명은 이것과 무관하다 (`jwt.access-ttl`, 기본 15분). 그건 서명 갱신 주기이지 세션 수명이 아니다
- **refresh 회전으로 늘어나지 않는다.** 회전한 세션은 원래 만료를 물려받는다 — 늘어나면 `ttl` 이 '수명' 이 아니라 '유휴 시간' 이 되어 15분마다 갱신하는 것만으로 무한정 붙들 수 있다
- 값을 줄여도 **이미 발급된 세션은 그대로다.** 즉시 끊으려면 `DELETE /admin/users/{id}/sessions` 를 쓴다

---

## 5-8. 연합 신원 교환 — `ixauth.federation.*`

> 2026-08-27 추가. 계약은 [`http-api.md`](http-api.md) §2-7 · [`token.md`](token.md) §3 · [`errors.md`](errors.md).

앱이 **이미 검증한** 외부 신원을 서비스 키로 제출하면, IX-Auth 가 그 사람을 계정에 잇고 세션을 발급한다. `ixauth.federated.*`(§2, IX-Trust 위임 [P4])와 **다른 키다** — 저쪽은 검증까지 위임하고, 이쪽은 검증을 앱이 한다.

| 키 | 환경변수 | 기본값 | 설명 |
|----|---------|--------|------|
| `enabled` | `IXAUTH_FEDERATION_ENABLED` | `false` | 전체 스위치. 끄면 `AUTH_FEDERATION_DISABLED`(403) |
| `allowed-providers` | `IXAUTH_FEDERATION_ALLOWED_PROVIDERS` | *(비어 있음)* | 쉼표로 구분한 provider 이름 (예: `nexus-hub`). 대소문자 무시. **비면 전부 거부** |
| `link-by-email` | `IXAUTH_FEDERATION_LINK_BY_EMAIL` | `true` | 같은 이메일의 계정이 있으면 연결. 끄면 `AUTH_FEDERATION_LINK_DENIED`(409) |
| `auto-provision` | `IXAUTH_FEDERATION_AUTO_PROVISION` | `true` | 처음 보는 사람의 계정을 만든다(JIT). 끄면 `AUTH_FEDERATION_NO_ACCOUNT`(404) |

### 왜 스위치와 허용 목록을 나누는가

이 경로의 신뢰 근거는 **서비스 키 하나뿐이다.** 키를 쥔 쪽이 "이 사람은 홍길동이다" 라고 말하면 jar 는 그대로 믿는다(그래서 jar 를 외부에 노출하지 않는 것이 이 기능의 전제다 — 설계 불변식 4).

"켜면 다 받는다" 로 두면 앱 하나를 붙이려고 켠 스위치가 **이름만 바꿔 오는 모든 요청**을 통과시킨다. 켜는 것과 무엇을 받을지를 따로 정하게 하면, 켠 사람이 자기가 허용한 범위를 스스로 적게 된다.

### `link-by-email` · `auto-provision` 의 기본값이 "가장 닫힌 값" 이 아닌 이유

전역 게이트(`enabled`, 기본 꺼짐 + 빈 허용 목록)가 이미 닫혀 있다. 그 문을 지난 요청까지 기본으로 막아 두면, 켠 운영자는 "켰는데 아무도 못 들어온다" 를 만나고 무엇을 더 켜야 하는지 문서를 뒤져야 한다. §5-2 의 셋(`require-email-verification` 등)과 같은 판단이다.

`link-by-email` 이 소셜 로그인(`social.auto-link-verified-email`)과 달리 **provider 의 이메일 검증 신호를 보지 않는** 것은, 여기서는 신원 확인이 이미 앱에서 끝났다는 것이 전제이기 때문이다. 그 전제를 믿을 수 없는 provider 를 받는다면 이 값을 끄고 연결은 관리자가 손으로 한다.

### 바꿔도 이미 발급된 세션은 그대로다

`enabled` 를 꺼도 그 경로로 만들어진 세션과 사용자는 남는다. 즉시 끊으려면 `DELETE /admin/users/{id}/sessions`, 계정을 막으려면 `PATCH /admin/users/{id}` 로 `status=DISABLED` 를 건다.

---

## 6. 계정 잠금 — `ixauth.lockout.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `enabled` | `true` | |
| `max-attempts` | `5` | 연속 실패 허용 횟수 |
| `duration` | `15m` | 잠금 지속. 경과 후 자동 해제 |
| `reset-window` | `30m` | 이 시간 동안 실패가 없으면 카운터 초기화 |

---

## 7. 인가 — `ixauth.authz.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `permission-map-cache` | `1h` | `/authz/permission-map` 응답의 `Cache-Control` |
| `check-cache-ttl` | `60s` | L2 판정 캐시 권장값 (앱 SDK 가 참고) [P2] |
| `fallback-on-unavailable` | `deny` | **jar 조회 실패 시 동작** — `deny`(fail-secure) \| `l1`(L1 권한으로 폴백) [P2] |
| `batch-check-max` | `100` | |
| `list-resources-max` | `1000` | 초과 시 `truncated: true` |

`fallback-on-unavailable` 기본값이 `deny` 인 이유: 인증 서버가 답을 못 하는 상태에서 접근을 허용하는 것보다 막는 쪽이 안전하다. 가용성이 더 중요한 앱은 `l1` 로 바꾼다.

---

## 8. 관리 화면 — `ixauth.admin-ui.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `enabled` | `true` | `false` 면 `/admin-ui/**` 가 **404** (존재 자체를 숨김) |
| `path` | `/admin-ui` | |
| `session-ttl` | `2h` | 관리 화면 자체 세션 |

---

## 9. Rate Limit — `ixauth.rate-limit.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `enabled` | `true` | |
| `login-per-minute` | `10` | |
| `refresh-per-minute` | `60` | |
| `default-per-minute` | `600` | |
| `storage` | `MEMORY` | `MEMORY`(인스턴스별) · `DATABASE`(공용 DB 에서 한 곳으로) |

로그인 제한은 요청 본문의 최종 사용자 `ip` 기준. 앱이 주지 않으면 서비스 키 단위로 폴백한다 ([`http-api.md`](http-api.md) §6).

### 인스턴스가 여럿일 때 — `storage`

> 2026-08-08 추가 (G26).

기본값 `MEMORY` 는 **인스턴스별로 센다.** 2대를 띄우면 실질 한도가 2배다. 그것이 곤란하면 `DATABASE` 로 바꿔 공용 DB(`ixauth.rate_limit_counters`)에서 한 곳으로 센다. 전용 Redis 를 두지 않는 것이 설계 불변식 3 이므로 이미 쓰는 앱 DB 를 쓴다.

**기본이 메모리인 이유는 DB 왕복이 로그인 경로에 붙기 때문이다.** 로그인은 이 제품에서 가장 뜨거운 경로이고, 거기에 왕복을 하나 더 얹는 것은 인스턴스가 여럿일 때만 값을 한다.

어느 쪽이든 **정확한 쿼터가 목적이 아니다.** 막으려는 것은 무차별 대입의 *속도*이므로 창 경계에서 몇 건이 새는 것은 문제가 되지 않는다 — 그래서 잠금도 직렬화도 쓰지 않는다. 정밀한 전역 제한이 필요하면 앞단(리버스 프록시·WAF)에서 거는 것이 맞다.

`DATABASE` 에서 DB 가 답하지 못하면 **인스턴스 메모리로 되돌아가 센다.** 통과시키면 DB 가 흔들리는 동안 무차별 대입에 문이 열리고, 막으면 DB 장애가 로그인 전면 중단이 된다.

> UPSERT 표기는 방언별로 다르다 — PostgreSQL 은 `ON CONFLICT`, MariaDB 는 `ON DUPLICATE KEY UPDATE` 를 쓰며 실행 시 JDBC URL 로 자동 선택된다(`DbDialect`). 켜야만 쓰이는 선택 사항이라 기본 경로에는 영향이 없다.

---

## 10. 감사 로그 — `ixauth.audit.*`

| 키 | 기본값 | 설명 |
|----|--------|------|
| `enabled` | `true` | |
| `retention-days` | `365` | 초과분 정리 배치. `0` 이면 무기한 |
| `log-failed-login` | `true` | 실패한 로그인도 기록 |
| `export-max` | `50000` | CSV 내보내기 1회 최대 행 수 |
| `client-ip-guard` | `WARN` | 잘못된 연동 감지. `OFF` · `WARN` · `STRICT` |

### 잘못된 연동 감지 (`client-ip-guard`)

> 2026-08-25 추가. 가이드 [`../guides/client-ip.md`](../guides/client-ip.md) 5절.

감사 IP 가 **방문자일 수 없는 주소**(사설망 · 링크로컬 · Cloudflare 엣지 대역)면 시스템 로그에 경고한다. 앱이 경유지 주소를 넘기면 감사 로그가 그 경유지로 굳는데, 이 실수는 화면에 아무 증상도 내지 않아 사고 조사 때에야 드러나기 때문이다. 실제로 소비 프로젝트 두 곳이 각각 다른 방식으로 같은 실수를 하고 있었다.

- 로그인 경로의 사건에서만 본다. 관리 API·배치의 IP 는 내부망 주소인 것이 정상이다
- 같은 이벤트·같은 원인은 10분에 한 번만 찍는다
- **기록을 바꾸지 않는다.** 넘어온 값을 그대로 적고 경고만 붙인다
- `WARN` 은 루프백을 넘긴다. 로컬 개발에서는 방문자가 실제로 `127.0.0.1` 이라 그것까지 경고하면 소음이 된다. 앱과 jar 가 다른 호스트인 운영은 `STRICT`
- 감지 건수는 `GET /admin/system/status` 의 `clientIpGuard` 에도 실린다

### CSV 내보내기 — 상한과 흔적

> 2026-08-08 추가 (G14 · G23). API 는 [`http-api.md`](http-api.md) §4.

- **상한을 둔다.** 없으면 기간을 넓게 잡은 요청 하나로 서버 메모리를 태울 수 있다. 걸리면 거기서 끊고 **잘렸다는 사실을 파일 마지막 줄에 적는다** — 조용히 끊으면 받는 사람은 그것이 전부인 줄 알고 보고서를 쓴다
- **내보내기 자체가 감사 로그에 남는다**(`AUDIT_EXPORTED`). 내려받은 파일에는 이메일·IP·User-Agent 가 줄줄이 들어 있다. 그건 열람이 아니라 **반출**이고, 반출 기록이 없으면 유출이 났을 때 어디로 나갔는지 되짚을 수 없다
- 파일은 UTF-8 BOM 으로 시작한다 — 없으면 엑셀에서 한글이 깨져 보인다

---

## 11. 설정 예시

```yaml
# application.yml (in-process 임베드 모드)
ixauth:
  mode: standalone
  db:
    url: jdbc:postgresql://localhost:5432/myapp
    username: myapp
    password: ${DB_PASSWORD}
  jwt:
    issuer: https://myapp.example.com
    access-ttl: 15m
  service-key: ${IXAUTH_SERVICE_KEY}
  admin:
    email: admin@example.com
    password: ${IXAUTH_ADMIN_PASSWORD}
```

```yaml
# docker-compose.yml (사이드카 모드)
services:
  ix-auth:
    image: registry.prost.kr/ix-auth:0.1.0
    environment:
      IXAUTH_DB_URL: jdbc:postgresql://db:5432/myapp
      IXAUTH_DB_USERNAME: myapp
      IXAUTH_DB_PASSWORD: ${DB_PASSWORD}
      IXAUTH_JWT_ISSUER: https://myapp.example.com
      IXAUTH_SERVICE_KEY: ${IXAUTH_SERVICE_KEY}
      IXAUTH_ADMIN_EMAIL: admin@example.com
      IXAUTH_ADMIN_PASSWORD: ${IXAUTH_ADMIN_PASSWORD}
    # 포트 외부 노출 없음 — 내부 통신 전용 (불변식 4)
```

---

## 12. 규칙

1. **모든 설정은 `IxAuthProperties` 한 곳에 모은다.** `@Value` 산발 금지
2. **시크릿을 로그에 남기지 않는다** — `service-key`, `db.password`, `jwt.private-key`, `admin.password`
3. 기본값이 있는 키는 **안전한 쪽**을 기본으로 둔다 (`fallback-on-unavailable: deny`, `cookie-secure: true`)
4. 새 키를 추가할 때 **기본값을 반드시 준다.** 기본값 없는 키를 추가하면 기존 배포가 부팅에 실패한다 (계약 하위 호환)
