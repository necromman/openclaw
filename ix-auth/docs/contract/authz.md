# 인가 계약

> **정본.** 설계 배경은 [`../design/authorization-model.md`](../design/authorization-model.md).\
> 변경 절차는 [`../../.claude/rules/contract-policy.md`](../../.claude/rules/contract-policy.md).

---

## 1. 2계층 요약

| 계층 | 대상 | 판정 위치 | 호출 |
|------|------|----------|------|
| **L1 정적** | 역할 · 그룹 · 페이지 · 기능 액션 | **앱 로컬** | 없음 (permission-map 캐시) |
| **L2 인스턴스** | 파일 · 폴더 · 문서 하나 | jar | `POST /authz/check` |

**L1 에서 jar 를 호출하면 설계 불변식 2 위반이다.**

---

## 2. 권한 코드 문법

```
<domain>:<resource>:<action>
```

| 파트 | 규칙 | 예 |
|------|------|-----|
| `domain` | 앱이 정의. 소문자·숫자·하이픈 | `page`, `file`, `board`, `ixauth` |
| `resource` | 계층은 `.` 또는 `/` 로 표현 | `admin.users`, `contracts/2026` |
| `action` | 소문자 동사 | `view`, `read`, `write`, `delete`, `download`, `share` |

전체 코드는 최대 200자. **사전 등록제** — `ixauth.permissions` 에 등록된 코드만 역할에 부여할 수 있다 (결정 A4).

### 와일드카드

| 패턴 | 의미 | `page:admin.users:view` 매칭 |
|------|------|------------------------------|
| `*` | 해당 파트 **전체** | `page:*:view` → ✅ |
| `*` (한 세그먼트) | 계층 한 단계 | `page:admin.*:view` → ✅ |
| `**` | 계층 **이하 전체** | `page:admin.**:view` → ✅ |
| — | — | `page:admin.*:view` vs `page:admin.users.detail:view` → ❌ (두 세그먼트) |
| `*:*:*` | 전권 | ✅ |

**세그먼트 구분자는 `.` 과 `/` 둘 다다.** `file:contracts/**:download` 는 `file:contracts/2026/a.pdf:download` 를 매칭한다.

### 매칭 알고리즘 (구현 규약)

```
1. 코드를 ':' 로 3파트 분리. 파트 수가 3이 아니면 오류 (AUTHZ_INVALID_PERMISSION_CODE)
2. 각 파트를 독립 비교한다
3. 파트가 '*' 면 무조건 일치
4. 그 외에는 [./] 로 세그먼트 분리 후 순서대로 비교
   - '*'  → 세그먼트 1개와 일치
   - '**' → 남은 세그먼트 전부와 일치 (반드시 마지막에만 온다)
   - 그 외 → 문자열 완전 일치 (대소문자 구분)
5. 모든 파트가 일치하면 매칭
```

`**` 가 중간에 오는 패턴(`a.**.c`)은 **지원하지 않는다.** 등록 시 거부한다.

---

## 3. L1 판정 (앱 로컬)

```
① 토큰의 ixauth_roles + ixauth_groups 를 읽는다
② permission-map 에서 그 역할들의 권한 코드를 모은다 (합집합)
③ 요청 권한 코드가 §2 매칭 규칙으로 하나라도 걸리면 허용
④ 아니면 거부
```

**유효 역할 = 직접 역할 ∪ 소속 그룹의 역할.** 이 계산은 **jar 가 토큰 발급 시점에 이미 끝낸다** — `ixauth_roles` 에 그룹 경유 역할까지 합쳐서 담는다. 앱은 그룹→역할 매핑을 몰라도 된다.

> `ixauth_groups` 를 따로 담는 이유는 L2 판정(주체가 그룹인 grant)과 앱의 표시 용도다.

**L1 에는 DENY 가 없다.** 역할 기반은 허용 목록으로만 표현한다. DENY 는 L2 에서만 쓴다 — L1 에 넣으면 "왜 권한이 없지" 추적이 어려워지고, 역할 조합에 따라 결과가 비직관적이 된다.

---

## 4. L2 판정 (jar 조회)

### 조회 대상

주체 = `USER:{userId}` ∪ `GROUP:{각 소속 그룹 id}` ∪ `ROLE:{각 유효 역할 id}`

리소스 = `resource_key` 의 **경로 상속 체인**. `/contracts/2026/a.pdf` 라면:

```
/contracts/2026/a.pdf     ← 정확 매칭
/contracts/2026/          ← 상위
/contracts/               ← 상위
/                         ← 루트
```

경로가 아닌 식별자(`doc-4821`)면 정확 매칭만 본다.

이 체인을 만들어 `resource_key IN (...)` 으로 조회한다. **prefix LIKE 를 쓰지 않는다** — 필요한 것은 조상이지 형제(`/contracts/2026/b.pdf`)가 아니며, prefix 는 형제까지 잡아 권한이 샌다.

### 판정 순서

```
1. 만료된 grant 제외 (expires_at < now)
2. 요청 action 과 매칭되는 grant 만 남긴다 ('*' 는 모든 action 매칭)
3. effect = DENY 가 하나라도 있으면 → 거부           ← DENY 우선 (결정 A3)
4. effect = ALLOW 가 하나라도 있으면 → 허용
5. grant 가 없으면 → L1 폴백
   요청을 '<resourceType>:<resourceKey>:<action>' 권한 코드로 변환해 L1 판정
   예: file:contracts/2026/a.pdf:download
6. 그래도 없으면 → 거부                              ← 기본 거부
```

**상속 거리는 우선순위에 영향을 주지 않는다.** 하위 경로의 ALLOW 가 상위의 DENY 를 이기지 않는다. DENY 는 언제나 최종이다.

> 이 선택의 근거: "이 폴더 전체 금지, 단 이 파일만 허용" 은 드물고 위험하다. 반대로 "전체 허용, 특정 폴더만 금지" 는 흔하다. 단순하고 안전한 쪽을 택했다.

---

## 5. 캐싱 — permission-map 과 `permissions_version`

### permission-map

```
GET /authz/permission-map
```

```json
{
  "version": 1786230000,
  "roles": {
    "ADMIN":  ["ixauth:*:*", "page:**:*"],
    "PM":     ["page:projects.**:view", "page:projects:write", "board:notice:write"],
    "VIEWER": ["page:projects.**:view"]
  }
}
```

- 앱은 **부팅 시 1회** 받아 메모리에 캐싱한다
- `version` = `permissions` · `role_permissions` · `groups` · `group_roles` 의 `max(updated_at)` 을 epoch 초로 환산한 값. **별도 테이블을 두지 않는다**
- 응답 크기는 보통 수 KB. 역할이 수백 개가 아닌 한 문제되지 않는다

### 무효화

토큰의 `ixauth_pv` 가 캐시된 `version` 보다 **크면** 맵을 다시 받는다.

```
if (token.ixauth_pv > cache.version) → GET /authz/permission-map 재조회
```

폴링이 필요 없다. 권한이 바뀌면 다음 토큰 발급(로그인 또는 refresh) 때 자연히 전파된다.

> **최대 지연 = access token TTL(15분).** 권한을 뺏었는데 15분간 남아 있을 수 있다. 즉시 반영이 필요하면 해당 사용자의 세션을 폐기(강제 재로그인)한다.

### L2 캐시

`/authz/check` 결과는 앱이 짧게 캐싱해도 된다 (권장 TTL 30~60초). 다만 **DENY 결과를 길게 캐싱하지 않는다** — 권한을 부여했는데 반영이 늦으면 사용자가 막힌다.

---

## 6. API

### 판정

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/authz/permission-map` | 서비스 키 | 역할 → 권한 전체 맵 + `version` |
| GET | `/authz/my-permissions` | access token | 현재 사용자의 유효 권한 목록 (메뉴 노출용) |
| POST | `/authz/check` | 서비스 키 | L2 단건 판정 |
| POST | `/authz/batch-check` | 서비스 키 | L2 다건 (최대 100건) |
| GET | `/authz/list-resources` | 서비스 키 | 접근 가능한 리소스 키 목록 |

#### `POST /authz/check`

```json
// 요청
{ "userId": "1042", "resourceType": "file", "resourceKey": "/contracts/2026/a.pdf", "action": "download" }

// 응답
{ "allowed": true, "reason": "GRANT_ALLOW", "matchedKey": "/contracts/2026/", "grantId": 331 }
```

`reason` 은 `GRANT_ALLOW` · `GRANT_DENY` · `L1_FALLBACK` · `NO_MATCH` 중 하나. **판정 근거를 항상 반환한다** — 권한 문제는 디버깅이 어렵고, 근거가 없으면 운영에서 원인을 못 찾는다.

#### `POST /authz/batch-check`

```json
{ "userId": "1042", "checks": [ { "resourceType": "file", "resourceKey": "/a.pdf", "action": "read" }, … ] }
```

응답의 `data` 는 **배열**이다 (다른 응답처럼 객체가 아니다). 요청과 **같은 순서**로 오고, 각 항목이 어느 키에 대한 판정인지 `resourceKey` 로 다시 밝힌다.

```json
{ "data": [
  { "resourceKey": "/contracts/2026/a.pdf",  "allowed": true,  "reason": "GRANT_ALLOW", "matchedKey": "/contracts/" },
  { "resourceKey": "/contracts/secret/x.pdf", "allowed": false, "reason": "GRANT_DENY",  "matchedKey": "/contracts/secret/" }
] }
```

**목록 화면에서 항목마다 `check` 를 호출하지 않는다.** 반드시 `batch-check` 또는 `list-resources` 를 쓴다 (N+1 금지 — 설계 불변식 2 예외 조항).

#### `GET /authz/list-resources?userId=1042&resourceType=file&action=read`

```json
{ "keys": ["/contracts/2026/", "/public/**", "doc-4821"], "truncated": false }
```

허용된 **키 패턴**을 돌려준다. 앱은 이걸로 자기 쿼리를 필터링한다. 1000건을 넘으면 `truncated: true` 로 알린다.

### 관리 (ADMIN 권한 필요)

| 메서드 | 경로 |
|--------|------|
| GET · POST · DELETE | `/admin/permissions` |
| GET · PUT | `/admin/roles/{roleId}/permissions` |
| GET · POST · PATCH · DELETE | `/admin/groups` |
| GET · POST · DELETE | `/admin/groups/{groupId}/members` · `/roles` |
| GET · POST · DELETE | `/admin/resource-grants` [P2] |

---

## 7. 구현 Phase

| 항목 | Phase |
|------|-------|
| 권한 코드 · 매칭 · L1 판정 · permission-map · 그룹 · 관리 API | **P1** |
| `resource_grants` · `/authz/check` · `batch-check` · `list-resources` · 경로 상속 | **P2** |

계약은 지금(P0) 전부 확정한다. 스키마를 나중에 붙이면 `users`/`roles` 를 다시 설계하게 된다.

---

## 8. 명시적 비목표

| 항목 | 이유 |
|------|------|
| 관계 그래프 순회 ("소유자의 매니저") | 조직 관계 모델 필요 → 제품 경계 밖. SpiceDB/OpenFGA 영역 |
| ABAC 동적 정책 엔진 | 정책 언어 + 평가기가 필요 |
| 행 단위 쿼리 필터 자동 적용 | IX-Auth 는 `list-resources` 로 키만 준다. 필터링은 앱이 한다 |
| L1 의 DENY | §3 — 추적 곤란 + 비직관적 결과 |
| `**` 중간 배치 (`a.**.c`) | 매칭 복잡도 대비 실익 없음. 등록 시 거부 |
