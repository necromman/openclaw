# IX-Auth

**신규 프로젝트에 동봉되는 경량 인증 서버.**

Spring Boot jar 하나. 별도 서버가 아니라 **앱과 같은 배포 단위 안에 함께 실린다.** 부팅하면 자기 DB 테이블을 스스로 만들고, 로그인·비밀번호 찾기·권한·사용자 관리 API 를 제공한다.

앱의 기술 스택은 무엇이든 상관없다 — 파이썬, Spring Boot, Spring 레거시, Node, React, Go. **HTTP 만 되면 붙는다.**

> **상태**: Phase 2.7 완료 — 인증·인가·계정·소셜·2단계 인증·약관·운영·사용자 대리 구현 및 실측 검증.
> 적합성 검사 84건 중 78 통과·0 실패(나머지는 꺼 둔 선택 기능이라 SKIP).\
> **DB 는 PostgreSQL · MariaDB · MySQL 8 을 모두 지원한다** (2026-08-21 — 세 방언 모두 실 컨테이너로 부팅 검증).\
> 진행 상황은 [`.claude/BACKLOG.md`](.claude/BACKLOG.md), 작업 지침은 [`.claude/CLAUDE.md`](.claude/CLAUDE.md).

---

## 1. 무엇이 되는가

### 인증

| 기능 | 상태 | 엔드포인트 |
|------|------|-----------|
| 로그인 / 로그아웃 | ✅ | `POST /auth/login` · `/auth/logout` |
| 토큰 갱신 (회전 + **재사용 탐지**) | ✅ | `POST /auth/refresh` |
| 공개키 게시 (앱이 로컬 검증) | ✅ | `GET /.well-known/jwks.json` |
| **TOTP 2단계 인증 + 백업 코드** | ✅ | `POST /auth/mfa/totp/setup` · `/confirm` · `/auth/mfa/verify` |
| **매직 링크 로그인** (비밀번호 없이) | ✅ | `POST /auth/magic-link/request` · `/verify` |
| 소셜 로그인 (MS · 카카오 · 네이버 · **Google**) | ✅ | [연동 가이드](docs/guides/social-login.md) |
| **step-up 인증** (민감 작업 재확인) | ✅ | 설정 `mfa.step-up-actions` |
| 계정 잠금 (실패 누적) | ✅ | 자동 |
| 속도 제한 (IP 기준, 버킷 4종) | ✅ | 자동 · 다중 인스턴스는 DB 모드 |
| **CAPTCHA** (reCAPTCHA v3) | ✅ | 설정 `captcha.*` |
| 레거시 해시 수용 + 조용한 재해싱 | ✅ | 자동 |
| **서명 키 자동 회전** | ✅ | 설정 `jwt.key-rotation-days` |

### 계정 라이프사이클

| 기능 | 상태 | 엔드포인트 |
|------|------|-----------|
| 비밀번호 찾기 → 재설정 | ✅ | `POST /auth/password/forgot` · `/auth/password/reset` |
| 비밀번호 변경 (현재 비번 확인) | ✅ | `POST /auth/password/change` |
| **비밀번호 재사용 이력 · 유출 비밀번호 차단** | ✅ | 설정 `password.history-count` · `check-breached` |
| 이메일 인증 · 이메일 변경 | ✅ | `POST /auth/email/verify` · `/auth/email/change` |
| 초대 (`PENDING` → 수락 → `ACTIVE`) | ✅ | `POST /admin/users/{id}/invite` · `/auth/invite/accept` |
| **회원가입** (즉시 / 승인제, 기본 **off**) | ✅ | `POST /auth/signup` — 도메인 제한·본인확인 선택 |
| **약관 동의** (버전·재동의·법적 증빙) | ✅ | `GET /auth/terms` · `POST /auth/terms/agree` |
| **본인 탈퇴** (즉시 / 유예 후) | ✅ | `POST /auth/account/delete` |
| 내 세션 목록 · 해지 · **기기 표시** | ✅ | `GET`/`DELETE /auth/sessions` |
| **새 기기 로그인 알림** · **동시 세션 제한** | ✅ | 설정 `account.notify-new-device` · `max-concurrent-sessions` |
| **사용자 속성 스키마** · **CSV 일괄 등록** | ✅ | `/admin/user-attributes` · `POST /admin/users/bulk` |
| 메일 발송 — SMTP · 웹훅 · 로그 | ✅ | 설정 |
| **메일 템플릿 편집 · 다국어(ko/en) · 발송 이력** | ✅ | `/admin/mail-templates` · `/admin/mail-deliveries` |

### 계정이 만들어지는 세 가지 경로

| 경로 | 설명 | 기본값 |
|------|------|--------|
| **초대** | 관리자가 만들고 본인이 비밀번호를 정한다 (`POST /admin/users` 에 password 를 비우면 이 방식) | 항상 가능 |
| **회원가입** | 본인이 직접 (`POST /auth/signup`). 즉시 사용 또는 **관리자 승인제** | **꺼짐** (`account.signup-mode`) |
| **소셜 로그인** | MS·카카오·네이버로 처음 들어온 사용자 자동 생성 | **꺼짐** (`social.auto-signup`) |

뒤의 둘이 꺼져 있는 이유 — 설치형이라 사내용 인스턴스가 대부분이고, 열어 두면 주소를 아는 누구나 계정을 만들 수 있다. 외부 사용자를 받는 서비스라면 켠다.

```yaml
ixauth.account:
  signup-mode: APPROVAL                   # CLOSED · OPEN · APPROVAL
  signup-verification: EMAIL              # NONE · EMAIL · PASS
  signup-allowed-domains: [prost.kr]      # 비우면 제한 없음
```

**이 값들은 관리 콘솔 → 설정에서 재시작 없이 바꾼다.** yml 은 기본값이고, 화면에서 바꾼 값이 DB 에 저장돼 덮어쓴다. 새 설정을 추가하면 화면이 저절로 생긴다 — 정의를 읽어 그리기 때문이다.

### 인가

| 층 | 대상 | 판정 위치 | 상태 |
|----|------|----------|------|
| **L1** | 역할 · 그룹 · 페이지 · 기능 | **앱이 스스로** (permission-map 캐시, 네트워크 0) | ✅ |
| **L2** | 파일 · 폴더 · 문서 *하나* | IX-Auth 조회 (`/authz/check`) — 경로 상속 · DENY 우선 | ✅ |

권한 코드 문법은 `<domain>:<resource>:<action>` 이고 `*`(한 세그먼트)·`**`(남은 전부)를 쓴다. 상세는 [`docs/guides/permission-model.md`](docs/guides/permission-model.md).

### 운영

감사 로그(append-only, **CSV 내보내기**·기간 필터) · 보존 정리 배치 · 만료 세션/토큰 정리 배치 · 내장 관리 콘솔(끌 수 있음) · **사용자 상세 화면** · `/health`.

**런타임 설정 77개** — 관리 콘솔에서 **재시작 없이** 바꾼다. 12개 그룹(가입 · 소셜 로그인 · 보안 · 2단계 인증 · 계정 운영 · 약관 · 메일 · 비밀번호 정책 · 토큰·세션 · 감사 로그 · 로그인 수단 · CAPTCHA). 시크릿(키·비밀번호)은 화면에서 다루지 않는다. 상세는 [`config.md`](docs/contract/config.md) §5-0.

---

## 2. 경계 — 앱이 만들 것과 IX-Auth 가 하는 것

**가장 자주 오해하는 부분이다.** IX-Auth 는 화면을 만들지 않는다(설계 불변식 1). 그리고 외부에 노출되지 않으므로(불변식 4) 사용자의 브라우저는 IX-Auth 를 **직접 열 수 없다.**

| | IX-Auth | 앱 |
|---|---|---|
| 비밀번호 해싱·정책·잠금 | ✅ | |
| 토큰 발급·검증·회전·재사용 탐지 | ✅ | |
| 메일 토큰 발급·해시 저장·1회용·만료 | ✅ | |
| **메일 발송**(SMTP/웹훅)과 기본 본문 | ✅ | |
| 재설정 성공 시 전 세션 폐기·잠금 해제 | ✅ | |
| 계정 존재 여부 은닉 | ✅ | |
| 권한 저장·L2 판정 | ✅ | |
| **로그인 화면** | | ✅ |
| **비밀번호 찾기 요청 화면** | | ✅ |
| **메일 링크가 도착하는 화면 3개** | | ✅ |
| **소셜 콜백 수신 경로** | | ✅ |
| 토큰을 HttpOnly 쿠키로 심기 | | ✅ |
| API 중계 (BFF) | | ✅ |

### 앱이 반드시 만들어야 하는 화면 3개

메일의 링크는 IX-Auth 가 아니라 **앱 주소**를 가리킨다. 그 도착지가 없으면 링크를 눌러도 갈 곳이 없다.

| 앱 경로 | 하는 일 | 설정 키 |
|---------|--------|--------|
| `/reset-password?token=…` | 새 비밀번호 입력 → `/auth/password/reset` 중계 | `ixauth.mail.reset-path` |
| `/accept-invite?token=…` | 비밀번호·이름 입력 → `/auth/invite/accept` 중계 | `ixauth.mail.invite-path` |
| `/verify-email?token=…` | 토큰만 꺼내 `/auth/email/verify` 호출 (입력 없음) | `ixauth.mail.verify-path` |

**참조 구현이 있다** — [`examples/react-demo/web/src/TokenPages.tsx`](examples/react-demo/web/src/TokenPages.tsx). 세 화면이 전부 한 파일에 들어가고, 로직은 없다. 토큰을 받아 넘기는 것뿐이다.

---

## 3. 5분 연동

### ① IX-Auth 를 띄운다

```yaml
# docker-compose.yml — 추가되는 전부
services:
  ix-auth:
    image: registry.prost.kr/ix-auth:1.0.0
    environment:
      # 앱이 쓰던 DB 를 그대로 쓴다. PostgreSQL 은 스키마만 ixauth 로 분리하고,
      # MariaDB/MySQL 은 같은 서버의 별도 데이터베이스를 쓴다:
      #   jdbc:mariadb://db:3306/ixauth?createDatabaseIfNotExist=true
      #   jdbc:mysql://db:3306/ixauth?createDatabaseIfNotExist=true
      # MySQL 에 mariadb 스킴으로 붙이지 않는다 — Flyway 가 URL 로 방언을 정한다
      IXAUTH_DB_URL: jdbc:postgresql://db:5432/myapp
      IXAUTH_SERVICE_KEY: ${IXAUTH_SERVICE_KEY}        # 32자 이상
      IXAUTH_JWT_ISSUER: https://myapp.example.com
      IXAUTH_ADMIN_EMAIL: admin@customer.com
      IXAUTH_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      # 비밀번호 찾기를 쓰려면 이 둘이 필요하다
      IXAUTH_MAIL_TRANSPORT: SMTP
      IXAUTH_MAIL_APP_BASE_URL: https://myapp.example.com   # 앱 주소다. IX-Auth 주소가 아니다
      IXAUTH_MAIL_SMTP_HOST: smtp.example.com
    # 포트 외부 노출 없음
```

부팅하면 스키마를 스스로 만들고 초기 관리자를 시드한다.

### ② 앱에 SDK 를 붙인다

| 스택 | 패키지 | 문서 |
|------|--------|------|
| Node / Express | `@ix-auth/client-node` | [`packages/client-node/README.md`](packages/client-node/README.md) |
| React | `@ix-auth/client-react` | [`packages/client-react/README.md`](packages/client-react/README.md) |
| Spring Boot | `ix-auth-client-spring` | [`ix-auth-client-spring/README.md`](ix-auth-client-spring/README.md) |
| Python / FastAPI | `ix-auth-client` | [`packages/client-python/README.md`](packages/client-python/README.md) |
| 그 외 | HTTP 직접 | [`docs/contract/http-api.md`](docs/contract/http-api.md) |

SDK 가 하는 일은 네 가지뿐이다 — 인증 중계 / **토큰 로컬 검증** / **L1 권한 로컬 판정** / L2 조회. 가운데 둘이 로컬이라 **IX-Auth 가 잠깐 내려가도 이미 로그인한 사용자는 계속 쓴다.**

⚠️ **로그인·갱신·로그아웃 세 호출 모두에 실방문자 IP·UA 를 넘긴다.** IX-Auth 는 앱 뒤에 있어 방문자의 주소를 스스로 알 수 없고, 잘못 넘긴 값은 되돌릴 수 없다. SDK 헬퍼(`requestMeta` · `client_meta_from`)를 쓰고, `req.ip` 나 `request.client.host` 를 직접 넣지 않는다. [**실방문자 IP 가이드**](docs/guides/client-ip.md)

```python
# FastAPI 예 — 앱이 붙일 것은 두 가지뿐이다
ixauth = IxAuthClient()
current_user, require_permission = build_dependencies(ixauth)

@app.get("/api/reports",
         dependencies=[Depends(require_permission("page:reports:view"))])
async def reports(): ...
```

### ③ 화면 3개를 만든다

위 2절의 표대로. [`TokenPages.tsx`](examples/react-demo/web/src/TokenPages.tsx) 를 복사해 프레임워크에 맞게 고치면 된다.

### ④ 소셜 로그인을 붙이려면

[**소셜 로그인 가이드**](docs/guides/social-login.md) 를 따른다 — provider 콘솔 등록(Azure·카카오·네이버)부터 BFF 코드, 계정 매칭 정책, 자주 겪는 문제까지 그 문서 하나로 끝난다.

⚠️ **콜백은 앱이 받는다.** provider 콘솔에 등록할 Redirect URI 는 전부 앱 주소다 — IX-Auth 주소를 적으면 동작하지 않는다.

---

## 4. 눈으로 먼저 보려면

```bash
examples/react-demo/run-demo.sh
```

PostgreSQL · IX-Auth jar · BFF · React 화면을 한 번에 띄운다. 브라우저에서 직접 눌러볼 수 있는 것:

- 로그인 → **IX-Auth 를 죽여도 세션이 유지되는지** (불변식 2 실측)
- 권한 판정 실험 (L1 — 입력 즉시 로컬 판정)
- 파일 권한 (L2 — `/contracts/` 권한이 하위로 상속되고, `/contracts/secret/` DENY 가 그것을 이긴다)
- **비밀번호 찾기 — 없는 주소를 넣어도 응답이 같다**
- 내 세션 목록 · 개별 해지

데모는 `transport=LOG` 라 메일이 실제로 나가지 않고 **jar 로그에 링크가 찍힌다.** 그 링크를 브라우저에 붙이면 재설정 화면으로 이어진다.

---

## 5. 계약이 정본이다

구현이 아니라 [`docs/contract/`](docs/contract/) 가 기준이다. SDK 를 새로 만들거나 API 를 호출할 때 여기를 본다.

| 문서 | 내용 |
|------|------|
| [`http-api.md`](docs/contract/http-api.md) | 엔드포인트·요청/응답. §2-1 계정 라이프사이클, §2-2 소셜 로그인 |
| [`token.md`](docs/contract/token.md) | JWT 클레임·TTL·JWKS·키 회전 |
| [`authz.md`](docs/contract/authz.md) | 권한 코드 문법·L1/L2 판정 규칙 |
| [`errors.md`](docs/contract/errors.md) | 에러 코드 전체 |
| [`config.md`](docs/contract/config.md) | `ixauth.*` 설정 키·기본값·환경변수 |
| [`schema.sql`](docs/contract/schema.sql) | 테이블 DDL |

**계약대로 도는지 검사하는 도구가 있다** — [`conformance/run.py`](conformance/README.md). SDK 를 쓰지 않고 HTTP 로만 76건을 확인한다. 새 SDK 를 만들면 이 검사가 통과하는 응답 형태를 기준으로 삼으면 된다.

```bash
python conformance/run.py --base-url http://localhost:9100 \
  --service-key ... --admin-email ... --admin-password ...
```

---

## 6. 설계 불변식 — 이 4가지는 협상 대상이 아니다

이걸 어기면 IX-Auth 가 아니라 "작은 IX-Trust" 가 된다. 상세는 [`.claude/rules/design-invariants.md`](.claude/rules/design-invariants.md).

| # | 불변식 | 어기면 |
|---|--------|--------|
| 1 | **헤드리스** — jar 가 로그인 화면을 렌더하지 않는다 | 프로젝트마다 디자인이 안 맞고, 고치려면 jar 를 포크한다 |
| 2 | **검증은 앱 로컬** — 매 요청마다 jar 를 호출하지 않는다 | jar 재시작 = 앱 전면 중단 |
| 3 | **앱 DB 공유** — 전용 DB·Redis 를 띄우지 않는다 | 관리 포인트가 늘어 존재 이유가 사라진다 |
| 4 | **외부 미노출** — jar 를 인터넷에 열지 않는다 | 도메인·SSL·WAF 가 따라온다 |

불변식 4 때문에 **메일 링크가 앱을 가리키고, 소셜 로그인 콜백도 앱이 받는다.** 이 두 가지는 불변식의 결과이지 설계 취향이 아니다.

소셜 로그인의 계정 매칭 규칙(어떤 provider 를 어디까지 믿는가)은 [`docs/contract/http-api.md`](docs/contract/http-api.md) §2-2 에 있다.

---

## 7. IX-Trust 와의 경계

| | IX-Auth | IX-Trust |
|---|---|---|
| 한 줄 | **앱 하나가 스스로 인증** | **여러 앱이 하나의 로그인을 공유** |
| 범주 | 동봉형 인증 서버 | SSO 플랫폼 |
| 배포 | 앱과 같은 배포 단위 | 독립 서버 (HA) |
| 프로토콜 | 자체 JWT (OIDC 관례 준수) | OIDC/OAuth2 + SAML 2.0 |

**표준 멘트: "앱 하나면 IX-Auth, 여러 개면 IX-Trust."**

⚠️ **IX-Auth 를 SSO 라고 부르지 않는다.** 기술적으로 틀리고, 고객이 "다른 앱과 계정이 연동되냐" 고 물었을 때 아니라고 답하게 된다.

### 승격 경로

```yaml
ixauth.mode: standalone   # 기본 — 동봉 jar 가 인증
ixauth.mode: federated    # IX-Trust 에 위임 (고객사 SSO 도입 시) [미구현]
ixauth.mode: hybrid       # 로컬 계정 + SSO 병행 [미구현]
```

**첫 단계는 있다** — `ixauth.federation.*`(2026-08-27) 은 앱이 **이미 검증한** 외부 신원을 서비스 키로 제출하면 그 사람을 계정에 잇고 세션을 발급한다([`docs/contract/http-api.md`](docs/contract/http-api.md) §2-7). 위 `federated` 모드와 다른 점은 **검증을 누가 하느냐**다 — 저쪽은 IX-Trust 에 검증까지 위임하고, 이쪽은 앱이 검증하고 jar 는 결과만 받는다. jar 는 여전히 화면을 그리지 않고 외부에 노출되지 않는다(설계 불변식 1·4).

경쟁이 아니라 **깔때기**다.

---

## 8. 어떤 프로젝트에 붙일 수 있나

| 케이스 | 지원 | 방식 |
|--------|------|------|
| **신규 프로젝트** | ✅ **주 대상** | jar 가 스키마를 만든다. 붙이면 끝 |
| **개발 중인데 로그인이 부실한 프로젝트** | ✅ 지원 | **IX-Auth 스키마로 이사** — [`docs/operations/migration-from-existing.md`](docs/operations/migration-from-existing.md) |
| **운영 중 · 실사용자 계정 보유** | ❌ 당분간 미지원 | 기존 테이블을 그대로 두려면 스키마 매핑 계층이 필요한데, **그게 IX-Auth 가 없애려던 바로 그 구조다** |

세 번째를 버리는 것이 이 제품의 중요한 선택이다. 브리지 모드를 넣으면 앱마다 제각각인 users 스키마를 매핑해야 하고, 결국 `SsoUserProvider` 같은 추상화가 되살아난다 — **프로젝트마다 로그인을 재개발하게 만든 바로 그 원인이다.**

---

## 9. 폴더 구조

| 경로 | 내용 |
|------|------|
| `ix-auth-server/` | jar 본체 (Spring Boot) |
| `ix-auth-common/` | 서버·SDK 공유 — 권한 매칭 규칙이 갈리지 않게 |
| `ix-auth-client-spring/` · `packages/` | 앱 측 SDK 4종 |
| `examples/react-demo/` | **참조 구현** — BFF·화면·토큰 페이지 |
| `conformance/` | 계약 적합성 검사 (HTTP 블랙박스) |
| `docs/contract/` | **계약 정본** — 여기가 기준이다 |
| `docs/design/` | 설계 정본 — 왜 이 구조인지, 무엇을 기각했는지 |
| `docs/guides/` | 연동 가이드 — [권한 모델](docs/guides/permission-model.md) · [소셜 로그인](docs/guides/social-login.md) · [파일 권한·저장소](docs/guides/file-permissions-storage.md) · [2단계 인증](docs/guides/mfa.md) · [약관 동의](docs/guides/terms.md) · [실방문자 IP](docs/guides/client-ip.md) |
| `docs/operations/` | 설치·이사 가이드 |
| `.claude/` | AI 작업 하네스 — **작업 시작 시 `CLAUDE.md` → `BACKLOG.md` 순으로 읽는다** |
| `reference/ix-trust/` | 이식 대상 원본. **읽기 전용, 빌드 미포함** |

---

## 10. 진행 단계

| Phase | 내용 | 상태 |
|-------|------|------|
| P0 | 계약 확정 | ✅ |
| P1 | jar MVP — 로그인·토큰·JWKS·L1 인가·관리 화면·감사 로그 | ✅ |
| P2 | L2 인스턴스 권한 + SDK 4종 + 적합성 검사 | ✅ |
| P2.5 | 계정 라이프사이클 — 비밀번호 찾기·이메일 인증·초대·세션 | ✅ |
| P2.6 | 소셜 로그인 — Microsoft · 카카오 · 네이버 · Google | ✅ |
| P2.7 | 기능 갭 33종 — 2단계 인증 · 약관 · 매직링크 · CAPTCHA · 운영 도구 | ✅ |
| **P3** | **실제 프로젝트 1건 적용 검증** | ⏳ 대상 선정 대기 |
| P2.8 | 연합 신원 교환 — 외부에서 확인한 신원으로 로그인 (`federated` 승격의 첫 단계) | ✅ |
| P4 | in-process 모드 · `federated` 승격 · WebAuthn(Q8) | ⏳ |

⚠️ **P3 전에 P4 를 다 채우지 않는다.** 첫 실적용에서 계약이 바뀔 가능성이 높다.

---

## 라이선스

Proprietary — PROST Inc. (prost.team)
