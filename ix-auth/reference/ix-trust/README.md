# reference/ix-trust — 이식 대상 원본 (읽기 전용)

> **이 폴더는 빌드에 포함되지 않는다.** IX-Trust 에서 가져온 참고물이며, **수정하지 않는다.**
> 이식 절차는 `.claude/rules/coding-style.md` 와 `/port` 커맨드 참조.

원본: `git.prost.kr/internal/IX-Trust` (2026-08-08 시점)

---

## 왜 그대로 쓰지 않는가

IX-Trust 는 SSO 플랫폼이다. 이 코드들에는 다음 전제가 섞여 있다:

- **사용자 저장소를 앱이 소유한다** (`SsoUserProvider` SPI) — IX-Auth 는 jar 가 직접 소유한다
- **원격 IdP 가 존재한다** (`issuerUri`/`clientId`/OIDC 교환)
- **여러 앱이 세션을 공유한다** (Back-Channel Logout, `sid` 바인딩, WebSocket 브로드캐스트)
- **조직·부서·직급 모델이 있다** (`org_id` 클레임, 30여 테이블)

통째로 복사하면 IX-Auth 가 다시 무거워진다. **발췌 → 축약 → 재작성 → 출처 주석** 순서를 지킨다.

---

## 파일별 이식 가이드

### `auth/` — 로컬 로그인 (재사용도 높음)

| 파일 | 이식 | 비고 |
|------|------|------|
| `AuthService.java` | ✅ **핵심** | email+BCrypt 검증 → JWT 발급. IX-Auth 로그인의 원형. `SsoUserProvider` 의존만 걷어내고 자체 리포지터리로 교체 |
| `AuthController.java` | ✅ | 엔드포인트 골격 |
| `AuthRequest/AuthResponse/LoginResponse/RefreshRequest` | ✅ | DTO. record 로 재작성 |

### `security/` — 토큰·필터 (재사용도 높음)

| 파일 | 이식 | 비고 |
|------|------|------|
| `JwtProvider.java` | ✅ **핵심** | ⚠️ 원본은 **HS256 대칭키**. IX-Auth 는 앱이 로컬 검증(불변식 2)하므로 **비대칭(RS256/ES256) + JWKS 게시**로 새로 설계해야 한다 |
| `JwtAuthenticationFilter.java` | ✅ | 관리 API 보호용 |
| `TokenBlacklistService.java` | ⚠️ 부분 | BCL 연동 부분 제거. IX-Auth 는 `sessions` 테이블로 무효화 |
| `CookieHelper.java` | ⚠️ 부분 | jar 는 쿠키를 발급하지 않는다(불변식 4 — 앱이 발급). 관리 화면용으로만 |
| `IxTrustSecurityCustomizer.java` | 참고 | 확장점 설계 참고용 |

### `spi/` — ❌ 이식하지 않음

`SsoUserProvider` · `SsoUserInfo` · `AbstractSsoUserProvider` · `SsoUserRepository` · `RoleMappingStrategy` · `OidcAttributes` · `UserExtraProvider`

**IX-Auth 는 users 를 직접 소유하므로 이 추상화 계층이 통째로 필요 없다.** 이것이 "프로젝트마다 로그인을 재개발하게 만든" 원인이었다 (설계 문서 §1.3). 반면교사로만 읽는다.

### `domain/` — 엔티티 (축약 이식)

| 파일 | 이식 | 비고 |
|------|------|------|
| `User.java` | ⚠️ **대폭 축약** | 조직·부서·직급·SSO 관련 필드 제거. `attributes` JSONB 추가 |
| `Role.java` | ⚠️ 축약 | 복합 역할(`RoleComposite`)·조직 스코프 제거 |
| `AuditLog.java` | ✅ | append-only 유지 |
| `BaseEntity.java` | ✅ | 생성/수정 시각 감사 |
| `UserCredential.java` | 참고 | WebAuthn 용. 경계 밖이지만 MFA[P2] 설계 시 참고 |

### `common/` — 공통 (재사용도 높음)

| 파일 | 이식 | 비고 |
|------|------|------|
| `ApiResponse.java` | ✅ | 응답 래퍼 |
| `GlobalExceptionHandler.java` | ✅ | 에러 코드 체계와 함께 |
| `JpaAuditingConfig.java` | ✅ | |
| `EncryptedStringConverter.java` | ✅ | MFA 시크릿 암호화[P2] |

### `sql/V1__baseline.sql` — ⚠️ 7종만 발췌

원본은 **테이블 17개**(이후 마이그레이션까지 합치면 30여 종). IX-Auth 는 `users` / `roles` / `user_roles` / `sessions` / `audit_logs` / `password_reset_tokens` / `mfa_credentials` **7종만**.

가져오지 않는 것: `oauth_clients` · `oauth2_authorization*` · `tenants`(조직) · `departments` · `positions` · `identity_providers` · `data_sources` · `sso_session_bindings` · `user_identity_links` · `push_subscriptions` · SCIM · 웹훅 · CIBA 관련 전부.

---

## 갱신

원본이 크게 바뀌어 다시 가져와야 하면 `D:\PROJECT\IX-Trust` 를 pull 한 뒤 해당 파일만 덮어쓴다. **이 폴더에서 직접 수정하지 않는다.**
