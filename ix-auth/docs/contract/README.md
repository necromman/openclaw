# contract — 계약 정본

> **상태: Phase 0 작성 중.** 아래 5개 문서가 완성되고 사용자 승인을 받으면 Phase 1(구현) 착수.

---

## 이게 왜 특별한가

계약은 **언어를 가로지르는 약속**이다. 여기에 맞추는 것들:

```
ix-auth-server (Java)          ─┐
ix-auth-sdk-spring (Java)      ─┤
ix-auth-sdk-react (TypeScript) ─┼─→  docs/contract/
ix-auth-sdk-python (Python)    ─┤
ix-auth-sdk-node (TypeScript)  ─┤
이미 적용된 앱들                ─┘
```

**한 곳을 바꾸면 다섯 군데가 깨진다.** 그래서 구현보다 먼저 확정한다.

---

## 파일

| 파일 | 내용 | 상태 |
|------|------|------|
| `token.md` | JWT 클레임 구조 · 서명 알고리즘 · TTL · JWKS 응답 형식 · 키 회전 | ✅ |
| `schema.sql` | DB DDL — **테이블 13종** (PostgreSQL `ixauth` 스키마 + MySQL 변형 주석) | ✅ |
| `http-api.md` | 엔드포인트 경로 · 요청/응답 스키마 · 상태코드 · rate limit | ✅ |
| `errors.md` | 에러 코드 체계 | ✅ |
| `config.md` | `ixauth.*` 설정 키 · 기본값 · `IXAUTH_*` 환경변수 매핑 | ✅ |
| `authz.md` | **인가 계약** — 권한 코드 문법 · L1/L2 구분 · `permission-map` 형식 · `permissions_version` · L2 판정 규칙 | ✅ |

**2026-08-08 초안 완성.** 사용자 검토 → 승인 후 Phase 1 착수.

요약 재료는 [`../../.claude/rules/architecture.md`](../../.claude/rules/architecture.md) 에도 있으나, **어긋나면 이 폴더가 이긴다.**

### 계약 전반을 관통하는 결정

| 결정 | 근거 |
|------|------|
| access = JWT(RS256, 15분) / refresh = **opaque 난수**(7일, DB 대조) | refresh 를 JWT 로 하면 앱이 로컬 검증하게 되어 **로그아웃이 실제로 먹지 않는다** |
| 토큰에 **역할만** 담고 권한은 안 담는다 | 권한은 수백 개가 될 수 있고, 바뀔 때마다 재발급이 필요해진다. 대신 `permission-map` 캐시 + `ixauth_pv` 버전 |
| 비밀번호 해시에 `{bcrypt}` 접두어 | 개발 중 프로젝트 이사 시 레거시 해시 수용 + 로그인 시 조용히 재해싱 |
| 로그인 실패 이유 미구분 | 계정 존재 여부 유출 방지. 단 **비밀번호가 맞은 뒤**의 잠금·비활성은 알려준다 |
| L1 에는 DENY 없음, L2 에만 | 역할 조합에 DENY 가 섞이면 "왜 권한이 없지" 추적이 불가능해진다 |
| 403 에 사유를 담지 않음 | 권한 구조 노출 방지. 단 `/authz/check` 는 판정 위임이므로 `reason` 반환 |

---

## 작성 규칙

1. **JWT 클레임 이름은 OIDC 관례를 따른다** — `sub`/`iss`/`aud`/`exp`/`iat`/`email`/`name`. 커스텀은 `ixauth_` 접두어
   > 이유: `ixauth.mode=federated` 로 IX-Trust 에 위임할 때 앱 코드가 그대로 동작해야 한다. 클레임 이름이 다르면 승격 경로가 막힌다
2. **테이블은 7종을 넘기지 않는다.** 앱 고유 필드는 `attributes` JSONB 또는 앱 프로필 테이블 + FK
3. **설계 불변식과 충돌하지 않는지 확인한다** — 특히 불변식 2(앱 로컬 검증)를 가능하게 하는 토큰 설계인가
4. **확정한 값에는 왜 그 값인지 한 줄을 남긴다**
   > 예: "access TTL 15분 — 앱 로컬 검증이라 즉시 무효화가 안 되는 대가를 짧은 수명으로 상쇄"

---

## 변경 절차

| 시점 | 절차 |
|------|------|
| **Phase 0** (지금) | 자유 수정. 단 변경 이유를 문서 안에 남긴다 |
| **Phase 1 이후** | ①불일치 근거 ②영향 범위 ③사용자 승인 ④문서 수정 ⑤`BACKLOG.md` 이력 |

상세: [`../../.claude/rules/contract-policy.md`](../../.claude/rules/contract-policy.md)

커밋은 `contract:` type 으로 **단독 커밋**한다.
