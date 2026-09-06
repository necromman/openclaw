# IX-Auth — 동봉형 인증 서버 설계 검토

> **작성**: 2026-08-08 (KST) · **개정 1**: 2026-08-08 — jar 사이드카 방식을 본안으로 채택, 라이브러리 방식은 대안으로 강등(§10) · **개정 2**: 2026-08-08 — **제품명 `IX-Auth` 확정**(§12 Q6 종결)
> **이 파일이 정본이다.** 지식베이스 사본(`chris-server` 레포 `docs/ix-trust/embedded-auth-kit-design.md`)은 검색용이며, 설계가 바뀌면 여기를 먼저 고치고 사본을 맞춘다.
>
> **근거**: `D:\PROJECT\IX-Trust` (git.prost.kr `internal/IX-Trust`) 코드 실측
> **목적**: "신규 프로젝트마다 로그인을 다시 개발하는" 페인포인트 해소
> **성격**: 검토·제안 문서. 미결정 항목은 §12.

---

## 0. 한 장 결론

**만들 것**: Spring Boot **jar 하나**. 별도 서버가 아니라 **신규 프로젝트와 같은 배포 단위 안에 동봉**되어 함께 뜬다. 부팅하면 자기 DB 테이블을 스스로 만들고, 로그인·토큰 발급·사용자 관리 API를 제공한다.

**앱은 언어가 무엇이든 상관없다.** 파이썬·Spring Boot·Spring 레거시·Node·React·Go — HTTP만 되면 붙는다.

```
[신규 프로젝트 서버 1대]
 ├─ 앱 컨테이너 (기술스택 무관)
 │    · 로그인 화면은 앱이 자기 프레임워크로 직접 (자유 커스터마이징)
 │    · 토큰 검증은 앱 안에서 로컬 처리 (네트워크 왕복 0)
 ├─ ix-auth.jar 컨테이너  ← 추가되는 건 이것 하나
 │    · 로그인 처리 / 토큰 발급 / 사용자·권한 관리 API / 관리 화면(내장, 끌 수 있음)
 │    · 외부 미노출 (내부 통신 전용) → 도메인·SSL 불필요
 └─ DB (앱 것 그대로 사용, 스키마만 분리)
```

**핵심 판단 4가지**:

| # | 판단 | 근거 |
|---|------|------|
| 1 | **IX-Trust SDK를 그대로 쓸 수 없다** | 현행 4종은 전부 *SSO 서버가 떠 있다는 전제*의 OIDC 클라이언트. `issuerUri`/`clientId`/`clientSecret` 없이는 부팅조차 안 된다 (§1.2) |
| 2 | **언어별 라이브러리 4벌보다 jar 1벌이 싸다** | 라이브러리 방식은 개발·유지보수·보안패치가 전부 4배. IX-Trust가 지금 SDK 4종 패리티로 그 비용을 치르는 중 (§10) |
| 3 | **jar는 "인증"만 하고, "검증"은 앱이 로컬에서 한다** | 매 요청 jar를 호출하면 jar 장애 = 앱 전면 중단. 검증을 로컬화하면 jar가 죽어도 기존 사용자는 계속 쓴다 (§5.2) |
| 4 | **Spring Boot 프로젝트는 컨테이너조차 안 는다** | 같은 jar를 의존성으로 넣으면 앱과 **같은 프로세스**에서 동작. 부트는 프로세스 +0, 다른 언어는 +1 (§5.6) |

---

## 1. 현재 자산 실측 (IX-Trust)

### 1.1 규모

| 모듈 | 성격 | 코드량(LOC, 테스트 제외) |
|------|------|------------------------|
| `ix-trust-api` | Spring Boot 4.1.0 | **27,779** |
| `ix-trust-web` | React 19 + MUI 관리 콘솔 | **18,568** |
| `ix-trust-core` | 공통 엔티티 32종 | 2,717 |
| `client-spring` / `client-react` / `client-fastapi` / `client-node` | SP용 SDK 4종 | 3,865 / 3,290 / 3,160 / 2,229 |
| Flyway 마이그레이션 | SQL | **78개 파일**, 테이블 30+ 종 |

### 1.2 SDK 4종의 실체

코드를 열어 보면 4종 모두 **"IX-Trust에 로그인을 위임하는 클라이언트(RP)"** 다. 인증 자체를 하지 않는다.

| SDK | 버전 | 자체(로컬) 로그인 | 필수 전제 |
|-----|------|------------------|-----------|
| `client-spring` | 1.9.12 | **부분 있음** — `AuthService.login()` 이 email+BCrypt 검증 후 자체 JWT 발급 | `ixtrust.client.issuerUri` |
| `client-fastapi` | 1.7.3 | ❌ JWT *검증*만, 로그인 엔드포인트 없음 | `IX_TRUST_ISSUER_URI` |
| `client-node` | 0.3.9 | ❌ SSO 전용 | `issuerUri`/`clientId`/`clientSecret`/`redirectUri` **모두 필수** |
| `client-react` | 0.12.8 | **있음** — `LoginPage.tsx` 가 SSO 비활성 시 이메일/비밀번호 폼 렌더 | 백엔드가 계약을 지키면 무관 |

### 1.3 매번 로그인을 다시 개발하게 되는 근본 원인

```java
// ix-trust-client-spring/.../spi/SsoUserProvider.java
public interface SsoUserProvider<ID> {
    Optional<? extends SsoUserInfo<ID>> findByEmail(String email);
    Optional<? extends SsoUserInfo<ID>> findById(String userIdAsString);
    boolean existsByEmail(String email);
    SsoUserInfo<ID> findOrCreateByOidc(OidcAttributes oidc);
    void createAdmin(String name, String email, String encodedPassword);
}
```

**사용자 저장소의 소유권이 앱에 있다.** 그래서 프로젝트마다 개발자가 다음을 새로 만든다:

1. `User` 엔티티 · 2. `users`/`user_roles` 테이블 + 마이그레이션 · 3. `UserRepository` · 4. `SsoUserProvider` 구현체 · 5. `SsoUserInfo` 어댑터 · 6. 비밀번호 정책·계정잠금·감사로그(SDK에 없어 전부 자체 구현)

**IX-Auth는 이 소유권을 jar 쪽으로 가져온다.** 앱은 users 테이블을 만들지 않는다.

---

## 2. 페인포인트 → 해소 방식 대조

| # | 페인포인트 | 확인된 실체 | IX-Auth의 해소 |
|---|-----------|------------|---------------|
| P1 | 프로젝트마다 로그인 재개발 | 사용자 저장소 소유권이 앱에 있음 (§1.3) | jar가 users를 소유, 스키마 자동 생성 |
| P2 | IX-Trust는 SSO라 설치형에 과대 | 단일 앱 때문에 46,000줄 + 테이블 30종 | 필요한 10%만 담은 별도 jar |
| P3 | 서비스 띄우면 관리 포인트 증가 | 설치 시 컨테이너 4개 + 도메인 + SSL + 배포 파이프라인 | 컨테이너 1개(부트는 0), 외부 미노출이라 도메인·SSL 불필요 |
| P4 | 프로젝트별 커스터마이징 자유 | 현행 SDK는 설정+SPI 2축뿐, 화면 변경은 포크 필요 | **화면을 jar가 그리지 않는다**(헤드리스). 앱이 자기 프레임워크로 = 100% 자유 |
| P5 | 배포 후에도 자유롭게 유지보수 | 아티팩트 의존은 업스트림 릴리스 대기 | 자주 고치는 화면·플로우가 앱 코드에 있음. jar는 설정·API로 확장 |
| P6 | 파이썬/부트/레거시/리액트 전부 | SDK 4종 패리티 유지 비용이 이미 문제 | **HTTP 계약 1개.** 언어 구현 자체가 사라짐 |
| P7 | DB 자동 구성 | 현행은 SP가 직접 스키마 작성 | jar 부팅 시 전용 스키마 자동 마이그레이션 |

---

## 3. IX-Trust를 그대로 못 쓰는 이유 (P2 근거)

기능이 부족해서가 아니라 **과하기 때문**이다. `docs/comparisons/keycloak-vs-ix-trust.md` 기준 IX-Trust는 이미 상용 IdP 급이다.

| 항목 | 단일 앱 로그인에 필요한가 |
|------|--------------------------|
| OAuth2 Authorization Server / SAML 2.0 IdP | ❌ |
| SCIM · DCR · CIBA · PAR · RAR · DPoP · WebAuthn | ❌ |
| 조직·부서·직급 트리, 멀티테넌시 | ❌ |
| 관리 콘솔 SPA 18,568줄 | ❌ (축약본이면 충분) |
| 로그인·세션·비밀번호 정책·계정잠금·감사로그 | ✅ **이것만** |
| MFA(TOTP) · 비밀번호 재설정 | ✅ 2차 |

**필요한 것은 IX-Trust의 10% 미만.** 나머지 90%가 관리 포인트로 전가된다.

---

## 4. 채택안 — 동봉형 jar (사이드카)

### 4.1 정직한 회계: 무엇이 줄고 무엇이 느는가

"서버를 안 띄우는" 것이 아니다. **프로세스는 하나 는다.** 다만 무거운 쪽이 사라진다.

| | 사라지는 것 | 새로 생기는 것 |
|---|---|---|
| **jar 동봉** | 별도 VM · 별도 도메인 · SSL 인증서 · 리버스 프록시 라우팅 · 별도 배포 파이프라인 · 중앙 SSO 운영 책임 · 언어별 SDK 4벌 | 컨테이너 1개(부트 프로젝트는 0) · 포트 1개 · JVM 메모리 250~400MB · 헬스체크 · 로그 |

인프라 관리는 실질적으로 사라지고, 남는 것은 `docker-compose.yml` 에 서비스 블록 하나다.

### 4.2 검증된 선례

| 제품 | 구조 | 비고 |
|------|------|------|
| **SuperTokens** | Core가 **자바 별도 프로세스**, 언어별 SDK는 얇은 HTTP 래퍼 | 이번 제안과 사실상 동일한 아키텍처 |
| **Ory Kratos** | Go 단일 바이너리, 완전 헤드리스, 관리 UI는 사용자가 제작 | 헤드리스 선례 |
| **Dex** | Go 단일 바이너리 OIDC | 경량 동봉 선례 |
| **Keycloak** | 같은 패턴이지만 무겁다 | 우리가 피하려는 지점 |

업계에서 반복 검증된 형태이며, 새로운 시도가 아니다.

---

## 5. 핵심 설계 결정

### 5.1 헤드리스 — 로그인 화면은 jar가 그리지 않는다

jar가 로그인 페이지를 렌더하면 ① 프로젝트마다 디자인이 안 맞고 ② 커스터마이징하려면 jar를 고쳐야 하고 ③ 사용자 눈에 "다른 시스템으로 넘어갔다"는 티가 난다.

→ **jar는 API만 제공한다.** 화면은 앱이 자기 프레임워크(React/Thymeleaf/JSP/Jinja)로 직접 만든다. 이러면 P4(커스터마이징 자유)가 라이브러리 방식보다 오히려 더 크게 확보된다.

React 프로젝트는 기존 `client-react` 의 `LoginPage`/`AuthProvider`/`useAuth` 를 거의 그대로 재사용할 수 있다.

### 5.2 토큰 검증은 앱이 로컬에서 — jar 장애를 무해화

**이번 설계에서 가장 중요한 결정.** 매 요청마다 jar를 호출하면 jar가 멈출 때 앱 전체가 멈춘다.

| 하는 일 | 누가 | 빈도 | jar 다운 시 |
|---------|------|------|------------|
| 로그인 · 토큰 발급 · 토큰 갱신 · 사용자 관리 | **jar 호출** | 낮음 (사용자당 하루 몇 번) | 신규 로그인만 불가 |
| **매 요청 토큰 검증** | **앱 내부에서 공개키로 직접 검증** | 높음 (초당 수십~수백) | **영향 없음** |

- jar가 `/.well-known/jwks.json` 으로 공개키를 게시 → 앱 SDK가 캐싱 후 서명 검증 (RS256/ES256)
- 각 언어에 이미 표준 라이브러리가 있다 (`jose`, `PyJWT`, `nimbus-jose-jwt`) → **SDK가 200~300줄로 얇아진다**
- 로그아웃 즉시성은 access token TTL 을 짧게(5~15분) + refresh 시 jar 확인으로 확보

**결과**: jar가 재시작 중이어도 로그인한 사용자는 아무 일 없이 앱을 쓴다.

### 5.3 관리 화면은 jar에 내장 — 다만 끌 수 있게

"관리자 화면은 신규 프로젝트에서 만들면 된다"로 두면 **새로운 반복 작업이 생긴다.** 사용자 목록·추가·비밀번호 초기화·권한 부여·잠금 해제는 어느 프로젝트에나 필요하다. 로그인을 안 만들게 됐는데 관리 화면을 매번 만들면 페인포인트가 이동만 한 셈이다.

→ **최소 관리 화면을 jar에 내장하고 `admin-ui.enabled=false` 로 끌 수 있게 한다.** 기본으로 쓰다가, 자체 화면이 필요하면 관리 API로 직접 만든다. IX-Trust 콘솔의 사용자·역할·감사로그 화면 축약본이라 추가 개발 비용도 작다.

### 5.4 DB — 앱 DB를 공유하고 스키마만 분리

- jar는 **앱이 이미 쓰는 DB에 접속한다.** DB 컨테이너를 새로 띄우지 않는다 (P3)
- 전용 네임스페이스로 충돌 차단 — PostgreSQL은 `ixauth` 스키마, MySQL 등은 `ixauth_` 프리픽스
- 부팅 시 Flyway로 **자동 마이그레이션**. 앱 마이그레이션과 독립적으로 버전 관리
- 개발 환경용으로 임베디드 H2 옵션 제공 (DB 없이 즉시 기동)

**최소 스키마 (초안)**

| 테이블 | 용도 |
|--------|------|
| `ixauth.users` | id, email, password_hash, name, status, failed_count, locked_until, attributes(JSONB) |
| `ixauth.roles` / `ixauth.user_roles` | 최소 RBAC |
| `ixauth.sessions` | 리프레시 토큰·세션 |
| `ixauth.audit_logs` | append-only 인증 이벤트 |
| `ixauth.password_reset_tokens` | 2차 |
| `ixauth.mfa_credentials` | TOTP·백업코드, 2차 |
| `ixauth.schema_version` | 킷 스키마 버전 |

> IX-Trust 30여 테이블 → **7개.**

**앱 고유 사용자 필드**는 3가지 중 선택:

| 방식 | 설명 | 적합 |
|------|------|------|
| A. `attributes` JSONB | jar 테이블의 JSON 컬럼 | 필드 소수 |
| B. 앱 프로필 테이블 + FK | `app_user_profiles.user_id → ixauth.users.id` | **권장 기본값** |

> ~~C. 브리지 모드(기존 앱 users 테이블을 jar가 참조)~~ — **2026-08-08 기각.** §5.4.1 참조.

### 5.4.1 도입 대상 — 3분류 (2026-08-08 확정)

"브라운필드 지원" 을 통으로 다루면 안 된다. 세 가지가 성격이 전혀 다르다.

| 케이스 | 상태 | 지원 | 방식 |
|--------|------|------|------|
| **A. 신규 프로젝트** | users 테이블 없음 | ✅ **주 대상** | jar 가 스키마를 만든다 (기본 동작) |
| **B. 개발 중 · 로그인 부실** | users 있으나 실사용자 데이터 없음(또는 버려도 됨) | ✅ **지원** | **IX-Auth 스키마로 이사** — 앱이 IX-Auth 에 맞춘다 |
| **C. 운영 중 · 실데이터 보유** | 실사용자 계정이 살아 있음 | ❌ **당분간 미지원** | 브리지 모드가 필요한데, 그 대가가 제품 정체성을 무너뜨린다 |

**C를 왜 버리는가** — 브리지 모드는 앱마다 제각각인 users 스키마를 매핑해야 하고, 그러려면 결국 `SsoUserProvider` 같은 추상화 계층이 되살아난다. **그게 바로 "프로젝트마다 로그인을 재개발하게 만든" 원인이다**(§1.3). 페인포인트를 없애려고 만든 제품이 같은 구조를 다시 들이는 셈이라, 지원 범위를 줄이는 쪽이 옳다.

**B는 왜 싼가** — 데이터가 없거나 버려도 되므로 "이사" 로 끝난다. 코드 기능이 아니라 **문서 + 예시 SQL** 수준이면 된다. 앱은 자기 users 테이블을 버리고 `ixauth.users` 를 쓰고, 고유 필드는 위 표의 B 방식(앱 프로필 테이블 + FK)으로 옮긴다.

**B를 위해 계약(P0)에 반드시 넣을 것 — 비밀번호 해시 호환**

이사 시 최대 걸림돌은 기존 비밀번호다. 알고리즘이 다르면 전원 재설정을 강제하게 되는데, 개발 중이라도 팀 계정이 날아가면 성가시다.

→ Spring Security `DelegatingPasswordEncoder` 방식으로 해시에 알고리즘 접두어를 붙여 저장한다 (`{bcrypt}$2a$...`). 레거시 해시를 그대로 받아들이고, **로그인 성공 시 조용히 현행 알고리즘으로 재해싱**한다.

> IX-Trust 도 같은 문제를 겪고 같은 방식으로 해결했다 — `V11__add_bcrypt_prefix_to_passwords.sql`. 나중에 붙이면 기존 행 전부를 손봐야 하므로 **처음부터 계약에 넣는다.**

### 5.5 앱 ↔ jar 통신

- jar는 **외부에 노출하지 않는다.** 내부 네트워크 전용 → 도메인·SSL·WAF 불필요
- 브라우저는 jar를 직접 호출하지 않는다. 앱이 로그인 폼을 받아 jar에 중계하고, 토큰을 받아 **앱 도메인 쿠키**로 심는다 (BFF 패턴 — 기존 SDK의 `bffMode` 와 동일 개념)
  - → 쿠키 도메인 문제·CORS 문제가 원천적으로 없다
- 앱 → jar 호출은 공유 시크릿 헤더로 인증. IX-Trust `ServiceApiKeyFilter` 재사용 가능

### 5.6 배포 형태 3종 — 같은 jar, 다른 태우는 법

| 방식 | 대상 | 추가 프로세스 |
|------|------|-------------|
| **A. Docker Compose 서비스 추가** | 대부분의 프로젝트 (권장) | +1 컨테이너 |
| **B. jar 직접 실행** (systemd) | Docker 미사용 환경 | +1 프로세스 (JRE 필요) |
| **C. in-process 임베드** | **Spring Boot 프로젝트 한정** | **+0** |

C가 보너스다. jar를 의존성으로 넣으면 auto-configuration이 앱과 **같은 JVM 안에서** 인증 엔드포인트를 띄운다. 부트 프로젝트는 컨테이너가 하나도 안 늘고, 다른 언어는 사이드카로 붙는다. **코드는 한 벌이다.**

```yaml
# A. docker-compose.yml — 추가되는 전부
services:
  ix-auth:
    image: registry.prost.kr/ix-auth:1.0.0
    environment:
      IXAUTH_DB_URL: jdbc:postgresql://db:5432/myapp
      IXAUTH_JWT_ISSUER: myapp
      IXAUTH_ADMIN_EMAIL: admin@customer.com
    # 포트 외부 노출 없음 — 내부 통신 전용
```

```java
// C. Spring Boot 프로젝트 — build.gradle.kts 한 줄
implementation("team.prost:ix-auth-embedded:1.0.0")
```

### 5.7 IX-Trust 승격 경로

설정 한 줄로 인증 주체를 바꾼다. **앱 코드는 손대지 않는다.**

| 모드 | 인증 주체 | 용도 |
|------|----------|------|
| `standalone` (기본) | 동봉 jar | 신규 프로젝트·단일 앱 설치형 |
| `federated` | IX-Trust (OIDC 위임), jar는 중계·로컬 계정 관리만 | 고객사가 SSO 도입 |
| `hybrid` | 로컬 계정 + SSO 병행 | 관리자만 로컬 (LX-Flow `ADR-001` 선례) |

**영업 관점**: 앱 1개는 무료 동봉 킷으로 끝내고, 앱이 여러 개로 늘면 IX-Trust SSO를 판다. 경쟁이 아니라 **깔때기**가 된다. 그리고 `federated` 모드는 현행 SDK 4종이 이미 구현해 둔 것이라 신규 개발이 거의 없다.

---

## 6. 기능 범위

| 구분 | 기능 |
|------|------|
| **1차 (MVP)** | 로그인/로그아웃 · JWT 발급/갱신 + JWKS 게시 · 비밀번호 해싱/정책 · 계정잠금 · **RBAC + L1 인가(권한·그룹·페이지 권한)** · 감사로그 · 초기 관리자 자동 시드 · **스키마 자동 마이그레이션** · 사용자 관리 API · **최소 관리 화면** |
| **2차** | 비밀번호 재설정(이메일) · TOTP MFA · 회원가입/초대 · 소셜 로그인 1~2종 · `federated` 모드 · in-process 모드 |
| **제외 (IX-Trust 영역)** | OAuth2 AS · SAML IdP · SCIM · CIBA/DCR/PAR/RAR/DPoP · WebAuthn · 조직/부서/직급 트리 · 웹훅 · 멀티테넌시 |

**경계 원칙**: *"내 앱 하나가 내 사용자를 인증한다"* 까지가 IX-Auth. *"여러 앱이 하나의 신원을 공유한다"* 부터가 IX-Trust. 이 목록은 기능 추가 요청을 **거절하는 기준**으로 쓴다 (§9 R5).

---

## 7. 기존 자산 재사용 매핑

사이드카 방식은 IX-Trust가 Spring Boot라는 점에서 재사용률이 가장 높다.

| IX-Auth 구성요소 | 재사용 원본 | 재사용도 |
|-----------------|-----------|---------|
| 로컬 로그인 서비스 | `client-spring/auth/AuthService.java` | **높음** |
| JWT 발급/검증 | `client-spring/security/JwtProvider.java` | **높음** |
| 토큰 블랙리스트 | `client-spring/security/TokenBlacklistService.java` | 높음 |
| 보안 필터 체인 | `client-spring/security/*`, `IxTrustSecurityCustomizer` | 높음 |
| 서비스 인증(앱→jar) | `ix-trust-api` `ServiceApiKeyFilter` | 높음 |
| 비밀번호 정책·계정잠금·감사로그 | `ix-trust-api` 본체 | **중간 — 추출 필요** |
| TOTP MFA | `ix-trust-api` (dev.samstevens.totp) | 중간 (2차) |
| 관리 화면 | `ix-trust-web` 사용자·역할·감사로그 화면 | **중간 — 대폭 축약** |
| 스키마 DDL | `V1__baseline.sql` 의 users/roles/audit 부분 | 발췌 후 축약 |
| 앱 측 React 연동 | `client-react` (`LoginPage`/`AuthProvider`/`useAuth`) | **높음** |
| 앱 측 언어별 SDK | 각 SDK의 JWT 검증부만 | 높음 (나머지는 버림) |
| `federated` 모드 | **현행 SDK 4종 전체** | 그대로 편입 |

> 새로 만들 것은 **jar 본체(축약된 인증 서버)** 와 **얇은 검증 SDK 3~4종**뿐이다.

---

## 8. 언어별 SDK — 왜 얇아지는가

라이브러리 방식에서는 언어마다 인증 로직 전체를 구현해야 했다. 사이드카에서는 SDK가 하는 일이 이것뿐이다:

1. 쿠키/헤더에서 토큰 꺼내기
2. JWKS 공개키로 서명 검증 (표준 라이브러리 호출)
3. 인증 실패 시 로그인 페이지로 보내기
4. 로그인/로그아웃 요청을 jar로 중계

**200~300줄.** 표준 JWT 검증이라 언어별 동작이 어긋날 여지가 거의 없다. Spring 레거시도 서블릿 필터 하나면 끝나서, 라이브러리 방식에서 가장 골치 아팠던 문제가 해소된다.

**계약 문서 + 적합성 테스트**는 여전히 만든다 — 단, 대상이 "인증 구현 전체"가 아니라 "HTTP API + 토큰 형식" 으로 훨씬 작아진다.

---

## 9. 리스크

| # | 리스크 | 완화 |
|---|--------|------|
| R1 | **JVM 메모리·JRE 의존** — 파이썬 팀 서버에 자바 런타임 | Docker 이미지 배포가 기본(런타임 포함) · 2차로 GraalVM native image 검토(메모리 250MB→50MB, 기동 0.1초) · 부트 프로젝트는 in-process라 무관 |
| R2 | **jar 장애 = 로그인 불가** | 토큰 검증 로컬화로 기존 세션 무영향(§5.2) · 헬스체크 + 자동 재시작 · 상태 비저장이라 재시작 안전 |
| R3 | **자체 IdP 구현의 보안 취약점** | 표준 라이브러리만 사용(암호 직접 구현 금지) · IX-Trust 검증된 코드 재사용 · 적합성 테스트에 보안 케이스 · 외부 점검 1회 |
| R4 | **자체 토큰이라 나중에 표준 전환 비용** | JWT 클레임을 OIDC 관례대로(`sub`/`iss`/`aud`/`exp`/`email`) 설계 → `federated` 전환 시 앱 코드 변경 최소 |
| R5 | **jar가 비대해짐** — "이것도 넣어주세요" 누적 | §6 제외 목록을 거절 기준으로 문서화 · 기능 추가 시 "IX-Trust로 승격" 을 대안으로 제시 |
| R6 | **IX-Trust와 코드 중복** | 별도 레포로 분리하되 초기 코드는 이식. 스키마가 7종 vs 30종이라 사실상 다른 제품이 되어 동기화 부담은 낮음 |
| R7 | **관리 화면 방치** | §5.3 내장 결정으로 해소 |

---

## 10. 대안 비교 — 언어별 라이브러리 방식을 왜 내렸나

개정 전 본안이던 방식(언어마다 인증 라이브러리 + 스캐폴드 배포)과의 비교다. 의사결정 이력으로 남긴다.

| 축 | 언어별 라이브러리 | **동봉 jar (채택)** |
|---|---|---|
| 추가 프로세스 | **0** | 1 (부트는 0) |
| 개발 공수 | 언어 수 × 1 = **4배** | **1배** |
| 유지보수·보안패치 | 4곳 동시 | **1곳** |
| 언어 패리티 어긋남 | 상시 위험 (IX-Trust가 겪는 중) | 거의 없음 |
| 새 언어 추가 | 처음부터 개발 | **HTTP만 되면 즉시** |
| Spring 레거시 | 자동설정 부재로 반쪽 | **동등** |
| 화면 커스터마이징 | 스캐폴드 복사로 자유 | **헤드리스라 더 자유** |
| 배포 후 유지보수(P5) | 스캐폴드 코드가 앱에 있어 자유 | 화면·플로우가 앱에 있어 자유 (동등) |
| JVM 의존 | 없음 | 있음 (Docker로 완화) |
| IX-Trust 코드 재사용 | 언어별 재작성 | **Spring Boot 자산 그대로** |

**결정 근거**: "관리 포인트 1개"보다 **"개발·유지보수 4배"가 훨씬 비싸다.** 컨테이너 하나는 compose 파일 몇 줄이지만, 언어 4개 패리티는 제품 수명 내내 나가는 비용이다. IX-Trust가 SDK 4종으로 이미 그 비용을 지불 중이라는 것이 실증 사례다.

라이브러리 방식의 유일한 우위(프로세스 0)는 **§5.6 C안(부트 in-process 모드)** 으로 부분 흡수했다.

---

## 11. 로드맵

| Phase | 산출물 | 규모 감 |
|-------|--------|--------|
| **P0. 계약 확정** | HTTP API 스펙 · JWT 클레임 구조 · DB DDL · 에러코드 | 1주 |
| **P1. jar MVP** | 로그인/토큰/JWKS · 사용자 관리 API · 자동 마이그레이션 · 최소 관리 화면 · Docker 이미지 | 3~4주 |
| **P2. 앱 측 SDK** | React + Spring Boot + FastAPI (+Node) 검증 SDK, 각 200~300줄 | 1~2주 |
| **P3. 실전 검증** | **실제 신규 프로젝트 1건에 적용** — 계약 수정 반영 | 2주 |
| **P4. 확장** | in-process 모드 · `federated` 승격 · TOTP · 비밀번호 재설정 | 이후 |
| **P5. (선택)** | GraalVM native image · Spring 레거시 필터 | 필요 시 |

**P3 전에 P4로 넘어가지 않는 것**이 중요하다. 첫 실적용에서 계약이 바뀔 가능성이 매우 높다.

---

## 12. 결정이 필요한 사항

| # | 질문 | 선택지 | 권고 |
|---|------|--------|------|
| Q1 | 레포 위치 | (a) IX-Trust에 `lite` 프로파일 추가 (b) **별도 레포** `internal/ix-auth` | **(b)** — 같은 코드베이스면 IX-Trust 릴리스에 묶이고 서로 무거워진다 |
| Q2 | 토큰 표준 수준 | (a) **자체 JWT(간단)** (b) 완전 OIDC 준수 | **(a)** — (b)까지 하면 그게 IX-Trust다. 단 클레임 이름은 OIDC 관례 준수(R4) |
| Q3 | 관리 화면 | (a) **jar 내장 + 끄기 가능** (b) 프로젝트가 직접 제작 | **(a)** — (b)는 페인포인트를 이동만 시킨다 (§5.3) |
| Q4 | 기본 배포 형태 | (a) **Docker 이미지** (b) 순수 jar | **(a)** — JRE 의존 문제 해소 |
| Q5 | 사용자 저장소 소유권 기본값 | (a) **jar 소유** (b) 앱 소유(현행) | **(a)** + 브리지 모드 병행 (§5.4) |
| ~~Q6~~ | ~~제품명~~ | — | ✅ **종결 (2026-08-08) — `IX-Auth` 확정.** 부록 B 네이밍 표 참조. 기각: IX-Gate(API Gateway 오인) · IX-Trust Lite(이름 길고 '열등판' 인상) · IX-Solo(인증 제품인지 불명) · IX-Pass(PASS 본인인증 충돌) · IX-Key(KMS 오인) · IX-Core(`ix-trust-core` 충돌) |
| Q7 | **첫 적용 대상 프로젝트** | — | **지정 필요.** 검증 없는 킷은 반드시 틀린다 |

---

## 부록 A. 실측 근거 파일

| 주장 | 근거 |
|------|------|
| Node SDK가 SSO 없이 부팅 불가 | `ix-trust-client-node/src/settings.ts:10-24` |
| Spring SDK에 로컬 로그인 존재 | `ix-trust-client-spring/.../auth/AuthService.java:23-43` |
| 사용자 저장소 소유권이 앱에 있음 | `.../client/spi/SsoUserProvider.java`, `.../spi/AbstractSsoUserProvider.java` |
| React SDK가 로컬 폼 지원 | `ix-trust-client-react/src/mui/LoginPage.tsx:22-27` |
| BFF 패턴이 이미 SDK에 존재 | `client-spring/IxTrustClientProperties.java:28` (`bffMode`) |
| 설치형이 컨테이너 4개 요구 | `docs/guides/installation.md` §1~2 |
| 테이블 30여 종 | `ix-trust-api/src/main/resources/db/migration/` (78개 파일) |
| IX-Trust 기능 범위 | `docs/comparisons/keycloak-vs-ix-trust.md` |
| 하이브리드(로컬+SSO) 선례 | `docs/decisions/ADR-001-lx-flow-self-login-exception.md` |
| SDK 패리티 유지 비용 | 각 SDK 주석의 "Spring 1.9.10 패리티" / "FastAPI 1.6.0 패리티" 반복 표기 |

---

## 부록 B. 제품명 · 명칭 규약 (2026-08-08 확정)

### B.1 이름은 `IX-Auth`

| 항목 | 값 |
|------|-----|
| 제품명 | **IX-Auth** |
| 한 줄 정의 | 신규 프로젝트에 동봉되는 경량 인증 서버 |
| 레포 | `git.prost.kr/internal/ix-auth` |
| 로컬 폴더 | `D:\PROJECT\ix-auth` |
| jar | `ix-auth.jar` |
| 도커 이미지 | `registry.prost.kr/ix-auth:<ver>` |
| Java 패키지 | `team.prost.ixauth` |
| 임베드 의존성 | `team.prost:ix-auth-embedded:<ver>` |
| DB 스키마 | `ixauth` (`ixauth.users`, `ixauth.roles`, …) |
| 설정 prefix | `ixauth.*` (예: `ixauth.mode = standalone \| federated`) |
| 환경변수 prefix | `IXAUTH_*` |

### B.2 "SSO" 라고 부르지 않는다 — 용어 규약

내부 문서·제안서·고객 설명에서 IX-Auth를 **SSO 라고 부르지 않는다.** 기술적으로 틀리고, 두 가지 사고를 부른다: ① IX-Trust와 무엇이 다른지 매번 해명해야 하고 ② 고객이 "다른 앱과 계정이 연동되냐"고 물었을 때 아니라고 답하게 된다.

| 용어 | 정의 | 해당 제품 |
|------|------|----------|
| **SSO (Single Sign-On)** | 여러 앱이 **하나의 로그인을 공유** | **IX-Trust** |
| **동봉형 인증 서버 (Embedded Auth Server)** | 앱 **하나가 스스로 인증** | **IX-Auth** |

**표준 영업 멘트**: *"앱 하나면 IX-Auth, 여러 개면 IX-Trust."*
경계가 이름만으로 떨어지고, 고객사 앱이 늘어나면 자연스럽게 IX-Trust 업셀로 넘어간다 (§5.7 승격 경로).
