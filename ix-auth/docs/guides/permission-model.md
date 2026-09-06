# 권한 모델 가이드

IX-Auth 의 권한을 실제로 어떻게 설계하고 운영하는지. 계약 문법은 [`../contract/authz.md`](../contract/authz.md), 설계 배경은 [`../design/authorization-model.md`](../design/authorization-model.md).

---

## 1. 두 층으로 나뉜다

| | L1 정적 권한 | L2 인스턴스 권한 |
|---|---|---|
| 대상 | 역할 · 그룹 · 페이지 · 기능 | 파일 · 폴더 · 문서 **하나** |
| 판정 | **앱이 스스로** (permission-map 캐시) | IX-Auth 에 조회 |
| 네트워크 | 없음 | 요청당 1회 |
| 예 | "PM 은 리포트를 본다" | "이 사람은 `/contracts/2026/` 을 받을 수 있다" |

**대부분은 L1 으로 끝난다.** L2 는 파일·문서처럼 "같은 종류인데 건마다 접근 권한이 다른" 것에만 쓴다.

---

## 2. Zanzibar 와의 관계 — 자주 오해받는 부분

> **L1 은 Zanzibar 가 아니다.** 역할에 권한 코드를 붙이는 고전적 RBAC 이다.\
> 동적으로 추가·관리되는 건 맞지만, Zanzibar 의 특징인 *관계 기반 판정*(ReBAC)은 쓰지 않는다.

**L2 가 Zanzibar 를 축소 참고한 쪽**이다. 다만 임의 관계 그래프 대신 **경로 상속**만 지원한다.

| 요구 | 지원 | 이유 |
|------|------|------|
| 폴더 권한을 하위 파일이 상속 | ✅ | 조상 경로만 조회하면 된다 |
| 문서를 특정 사용자·그룹에 공유 | ✅ | 주체별 grant |
| "문서 소유자의 **매니저**는 볼 수 있다" | ❌ | 관계 그래프 순회 필요 |
| "프로젝트 멤버의 팀의 상위 부서장은…" | ❌ | 동상 |

포기한 것들은 **조직 관계 모델**을 요구한다. 그건 여러 앱이 신원을 공유하는 영역(IX-Trust)이지 IX-Auth 의 범위가 아니다. 그 정도 표현력이 정말 필요하면 SpiceDB·OpenFGA 같은 전용 제품이 맞다.

**왜 그래프를 안 쓰는가** — 재귀 순회는 매 요청 서버 왕복을 요구한다. 그러면 인증 서버가 앱의 가용성과 성능을 좌우하게 되어, 이 제품이 피하려던 지점으로 되돌아간다.

---

## 3. 권한 코드 설계

```
<domain>:<resource>:<action>
```

`domain` 은 앱이 자유롭게 정한다. 계층은 `.` 또는 `/` 로 표현한다.

```
page:admin.users:view          관리자 사용자 화면
page:projects.detail:edit      프로젝트 상세 편집
board:notice:write             공지 작성
file:contracts/2026:download   계약 폴더 다운로드
report:monthly:export          월간 리포트 내보내기
```

### 와일드카드

| 패턴 | 요청 | 결과 |
|------|------|------|
| `page:*:view` | `page:admin.users:view` | 허용 |
| `page:admin.*:view` | `page:admin.users:view` | 허용 |
| `page:admin.*:view` | `page:admin.users.detail:view` | **거부** — `*` 는 한 단계만 |
| `page:admin.**:view` | `page:admin.users.detail:view` | 허용 — `**` 는 이하 전부 |
| `*:*:*` | 무엇이든 | 허용 (전권) |

`**` 는 **마지막 단계에만** 올 수 있다. `a.**.c` 는 등록 시 거부된다.

### 설계 요령

- **화면 단위로 시작한다.** `page:<화면>:view` 부터 만들고, 편집·삭제가 갈릴 때 `:edit`, `:delete` 를 추가한다
- **처음부터 잘게 쪼개지 않는다.** 권한이 100개가 되면 아무도 관리하지 않는다
- **`*` 를 남발하지 않는다.** `page:*:*` 를 주는 순간 그 역할은 사실상 관리자다
- 권한 코드는 **사전 등록제**다. 등록되지 않은 코드는 역할에 부여할 수 없다 (오타 방지)

---

## 4. 역할과 그룹

| 개념 | 쓰임 | 예 |
|------|------|-----|
| **역할** | 권한 묶음 — "무엇을 할 수 있는가" | `ADMIN`, `PM`, `VIEWER` |
| **그룹** | 사람 묶음에 역할을 한 번에 부여 | `개발팀`, `외부협력사` |

사용자의 **유효 역할 = 직접 부여분 ∪ 소속 그룹의 역할**. 이 합집합은 IX-Auth 가 토큰 발급 시점에 계산해 `ixauth_roles` 클레임에 담으므로, **앱은 그룹→역할 매핑을 몰라도 된다.**

### 그룹은 조직도가 아니다

"이 그룹에 권한을 주는가" 면 IX-Auth 에 두고, "이 사람이 조직 어디에 속하는가" 는 앱이 관리한다. 부서 트리·직급·보고 라인은 IX-Auth 에 넣지 않는다.

### 역할에 계층이 없는 이유

상위 역할이 하위를 상속하면 편해 보이지만, **"이 사람이 왜 이 권한을 갖고 있지" 를 추적하기 어려워진다.** 권한을 중복 부여하는 편이 명시적이다. 필요해지면 나중에 추가할 수 있다 — 반대는 어렵다.

---

## 5. L2 — 파일·폴더 권한

```
POST /admin/resource-grants
{
  "subjectType": "USER",        // USER | GROUP | ROLE
  "subjectId": 42,
  "resourceType": "file",
  "resourceKey": "/contracts/",  // 폴더는 끝에 /
  "action": "download",
  "effect": "ALLOW",             // ALLOW | DENY
  "expiresAt": "2026-12-31T23:59:59Z"   // 선택 — 임시 권한
}
```

### 상속

`/contracts/` 에 준 권한은 그 아래 전부에 적용된다.

```
/contracts/           ← ALLOW download
  └ 2026/
      └ a.pdf         ← 허용 (상속)
  └ secret/           ← DENY download
      └ x.pdf         ← 거부 (DENY 가 상속을 이긴다)
```

**DENY 는 상속 거리와 무관하게 최종이다.** 하위의 ALLOW 가 상위의 DENY 를 이기지 않는다. "전체 허용 + 특정 폴더만 제외" 가 실무에 흔하고, 그 반대는 드물면서 위험하기 때문이다.

**형제는 영향받지 않는다.** `/contracts/secret/` 의 DENY 가 `/contracts/2026/` 를 막지 않는다. 조상만 보기 때문이다.

### 판정 순서

```
1. 만료된 grant 제외
2. 요청 action 을 덮는 grant 만       ('*' 는 모든 action)
3. DENY 가 하나라도 → 거부
4. ALLOW 가 하나라도 → 허용
5. 없으면 L1 폴백 — file:contracts/2026/a.pdf:download 로 판정
6. 그래도 없으면 거부                  (기본 거부)
```

5번 덕분에 **역할로 광역 권한을 주고, 예외만 L2 로 다룰 수 있다.** 예: `VIEWER` 에게 `file:public/**:download` 를 주고, 특정 파일만 DENY.

### 목록 화면에서는

항목마다 `check` 를 부르면 N+1 이다. **`batch-check` 또는 `list-resources`** 를 쓴다.

```js
// 나쁨 — 100개 항목이면 100번 왕복
for (const f of files) await ixauth.check(userId, 'file', f.path, 'read')

// 좋음
const r = await ixauth.batchCheck(userId, files.map(f => ({
  resourceType: 'file', resourceKey: f.path, action: 'read'
})))

// 더 좋음 — 애초에 접근 가능한 것만 쿼리한다
const { keys } = await ixauth.listResources(userId, 'file', 'read')
```

---

## 6. 권한을 바꿨는데 반영이 안 될 때

정상이다. 앱은 권한 맵을 캐싱하고, **토큰이 새로 발급될 때** 변경을 알아챈다. 그래서 최대 **액세스 토큰 수명(기본 15분)** 만큼 늦을 수 있다.

| 원하는 것 | 방법 |
|-----------|------|
| 자연 반영 | 기다린다 (최대 15분) |
| **즉시 반영** | 관리 화면에서 해당 사용자의 **세션을 종료** → 재로그인 시 새 권한 적용 |
| 전체 즉시 반영 | 토큰 TTL 을 줄인다 (`ixauth.jwt.access-ttl`) — 대신 refresh 왕복이 늘어난다 |

이 지연은 **로컬 판정의 대가**다. 매 요청 서버에 물으면 즉시 반영되지만, 그러면 인증 서버가 앱의 성능·가용성을 좌우하게 된다.

---

## 7. 감사 로그의 IP 가 이상할 때

IX-Auth 는 **앱 뒤에 있다.** 앱이 최종 사용자 IP 를 넘겨주지 않으면 앱 서버 주소만 남는다.

```js
// 앱이 로그인을 중계할 때 최종 사용자 정보를 함께 보낸다
await ixauth.login(email, password, { ip: req.ip, userAgent: req.get('User-Agent') })
```

리버스 프록시 뒤라면 프록시가 `X-Forwarded-For` 를 전달하도록 하고, Express 는 `app.set('trust proxy', true)` 를 켠다. IX-Auth 는 `X-Forwarded-For` → `X-Real-IP` → 원격 주소 순으로 본다.

> IPv6 루프백(`::1`, `0:0:0:0:0:0:0:1`)은 `127.0.0.1` 로 통일해 기록한다.\
> 같은 접속이 두 표기로 갈리면 IP 로 묶어 보기 어렵기 때문이다.

---

## 8. 시작하는 방법

1. **화면 목록을 뽑는다** → `page:<화면>:view` 로 권한 코드 등록
2. **역할을 2~3개로 시작한다** — `ADMIN` / 실무 역할 / `VIEWER` 정도
3. 각 역할에 권한 부여
4. 사람이 늘면 **그룹**으로 묶어 역할을 일괄 부여
5. 파일·문서처럼 건별로 갈리는 것만 **L2** 로 넘긴다

처음부터 완벽한 권한 체계를 설계하려 하지 않는 편이 좋다. 화면 권한부터 시작해서 필요할 때 쪼개는 쪽이 실제로 관리된다.
