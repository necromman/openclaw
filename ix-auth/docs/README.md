# docs

| 폴더 | 성격 | 상태 |
|------|------|------|
| **`contract/`** | **계약 정본** — 서버·SDK·앱이 전부 여기에 맞춘다 | Phase 0 작성 중 |
| `design/` | 설계 정본 — 왜 이 구조인지, 무엇을 기각했는지 | 완료 |
| `operations/` | 설치·운영 가이드 | Phase 1 이후 |

---

## contract/ — 언어를 가로지르는 약속

| 파일 | 내용 |
|------|------|
| `token.md` | JWT 클레임 · 서명 알고리즘 · TTL · JWKS 형식 · 키 회전 |
| `schema.sql` | DB DDL (테이블 7종) |
| `http-api.md` | 엔드포인트 요청/응답 스키마 · 상태코드 |
| `errors.md` | 에러 코드 체계 |
| `config.md` | `ixauth.*` 설정 키 · `IXAUTH_*` 환경변수 |

**여기를 바꾸면 다섯 군데가 깨진다** — 서버(Java) + SDK 4종(Java/TS/Python/Node) + 이미 적용된 앱.

변경 절차는 [`.claude/rules/contract-policy.md`](../.claude/rules/contract-policy.md).

---

## design/ — 설계 정본

| 파일 | 내용 |
|------|------|
| `embedded-auth-server-design.md` | **정본.** 페인포인트 진단(IX-Trust 코드 실측) · 채택안(jar 사이드카) · 설계 결정 7종 · 기각안(언어별 라이브러리 4벌)과 근거 · 도입 대상 3분류 · 리스크 · 로드맵 · 제품명 규약 |
| `authorization-model.md` | **인가 모델 정본.** 갭 진단(역할은 있는데 권한이 없다) · Zanzibar 를 그대로 못 쓰는 이유 · L1(앱 로컬 판정)/L2(경로 상속 조회) 2계층 · 권한 코드 체계 · 캐싱 전략 · 스키마 6종 |

> 같은 문서 사본이 지식베이스(`chris-server` 레포 `docs/ix-trust/embedded-auth-kit-design.md`)에도 있다. **이 레포 것이 정본**이며, 설계가 바뀌면 여기를 먼저 고친다.

---

## 읽는 순서

처음이라면:

1. [`../README.md`](../README.md) — 제품이 무엇인지, IX-Trust 와 어떻게 다른지
2. `design/embedded-auth-server-design.md` §0 (한 장 결론) · §4 (채택안) · §5 (설계 결정)
3. [`../.claude/rules/design-invariants.md`](../.claude/rules/design-invariants.md) — 어기면 안 되는 4가지
4. [`../.claude/rules/product-boundary.md`](../.claude/rules/product-boundary.md) — 만들 것 / 안 만들 것
