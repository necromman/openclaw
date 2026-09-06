# 파일 권한 — 저장소별 연동

파일이 **어디에 있느냐**에 따라 붙이는 방법이 다르다. 로컬 디스크·NAS·S3·SeaweedFS, 그리고 "파일서버가 스스로 권한을 관리하는" 경우까지.

---

## 0. 먼저 정할 것 — 누가 판정하는가

| | 판정 주체 | 언제 |
|---|----------|------|
| **A. IX-Auth 가 판정** | IX-Auth | 저장소에 권한 개념이 없거나(로컬 디스크·단순 버킷), 앱이 파일 접근을 전부 중계할 때 |
| **B. 저장소가 판정** | 파일서버 | Nextcloud·MinIO IAM 처럼 자체 권한 체계가 있고, 그것이 이미 운영 중일 때 |
| **C. 혼합** | 둘 다 | 화면 노출 여부는 IX-Auth(L1), 실제 파일 접근은 저장소 |

**A 와 B 를 동시에 켜지 않는다.** 두 곳에서 각각 판정하면 어느 쪽이 진짜인지 알 수 없고, 한쪽만 고치는 사고가 난다. 관리 콘솔 → **파일 권한** → 리소스 종류에서 **권한 관리 주체**를 골라 못 박는다.

B 를 고르면 IX-Auth 는 그 종류를 판정하지 않고 `DELEGATED` 라고 답한다. 앱은 그 신호를 보고 저장소에 물으면 된다.

---

## 1. 리소스 종류를 먼저 등록한다

키 표기가 저장소마다 다르고, **표기가 어긋나면 권한이 조용히 없는 것이 된다.** `/contracts/a.pdf` 로 주고 `contracts/a.pdf` 로 물으면 걸리지 않는데, 그 결과는 "권한 없음" 과 구분되지 않아 원인을 찾기 어렵다.

관리 콘솔에 기본 3종이 들어 있다.

| 코드 | 키 형식 | 대소문자 | 쓰는 곳 |
|------|--------|---------|--------|
| `file` | `PATH` | 구분 | 로컬 디스크 · NAS · SeaweedFS filer |
| `s3` | `S3` | 구분 안 함 | AWS S3 · MinIO · SeaweedFS S3 게이트웨이 |
| `doc` | `OPAQUE` | 구분 | 문서 ID 등 경로가 아닌 식별자 |

필요하면 추가한다 (예: `s3-archive`, `nas-hr`).

### 정규화 규칙

| 형식 | 하는 일 | 예 |
|------|--------|-----|
| `PATH` | 앞에 `/` 강제, `//`→`/`, `\`→`/` | `contracts/a.pdf` · `\contracts\a.pdf` → `/contracts/a.pdf` |
| `S3` | `s3://` 접두 제거 후 PATH 규칙 | `s3://docs/a.pdf` · `docs/a.pdf` → `/docs/a.pdf` |
| `OPAQUE` | 공백만 정리 (상속 없음) | `doc-4821` |

**부여할 때와 물을 때 같은 규칙이 적용된다.** 그래서 어느 표기로 넣어도 걸린다.

`..` 이 들어간 키는 거부한다 — `/contracts/../../etc/` 같은 것으로 권한 밖을 가리킬 수 있다.

---

## 2. 저장소별

### 2-1. 로컬 디스크 · NAS (마운트된 공유)

가장 단순하다. 종류 `file`, 키는 앱이 쓰는 경로 그대로.

```
부여   USER:42  file  /projects/alpha/   read,download  ALLOW
판정   /projects/alpha/docs/spec.pdf     → 허용 (상위 폴더에서 상속)
```

**앱이 파일을 직접 서빙한다면** 내려주기 전에 물어본다.

```js
app.get('/files/*path', authenticated, async (req, res) => {
  const key = '/' + (Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path)
  const v = await ixauth.check(req.claims.sub, 'file', key, 'download')
  if (!v.allowed) return res.status(403).json({ code: 'FORBIDDEN' })
  res.sendFile(path.join(FILE_ROOT, key))
})
```

⚠ **경로를 그대로 파일시스템에 넘기지 않는다.** IX-Auth 는 권한만 보고, 경로 탈출(`..`)은 앱도 다시 막아야 한다. `path.resolve` 후 루트 밖이면 거부한다.

### 2-2. S3 · MinIO

종류 `s3`. 키는 `버킷/오브젝트키` 로 생각하면 된다 — `s3://` 를 붙여도 같다.

```
부여   GROUP:5  s3  docs/2026/   read  ALLOW
판정   s3://docs/2026/q3.xlsx    → 허용
```

**권장 패턴 — 앱이 presigned URL 을 발급한다.**

```
① 브라우저 → 앱      GET /api/files/docs/2026/q3.xlsx
② 앱 → IX-Auth      check(user, 's3', 'docs/2026/q3.xlsx', 'read')
③ 앱 → S3           presigned URL 생성 (짧은 만료)
④ 앱 → 브라우저      302 리다이렉트
```

이러면 파일 본문이 앱을 거치지 않아 대역폭을 아끼면서 권한은 IX-Auth 가 판정한다. **presigned URL 의 만료를 짧게 잡는다** — 한 번 발급되면 그 URL 을 가진 누구나 접근할 수 있어 이후에는 권한 회수가 듣지 않는다.

MinIO 자체 IAM 정책을 쓰고 있다면 **B(위임)** 를 고른다. 두 곳에서 판정하지 않는다.

### 2-3. SeaweedFS

두 가지 접근 방식이 있고, 쓰는 쪽에 맞춰 종류를 고른다.

| 접근 | 종류 | 키 |
|------|------|-----|
| **filer** (`/buckets/…` 경로) | `file` (PATH) | `/buckets/docs/2026/a.pdf` |
| **S3 게이트웨이** | `s3` (S3) | `docs/2026/a.pdf` |

filer 를 쓰면 경로 상속이 자연스럽게 맞는다. SeaweedFS 는 자체 사용자 권한이 약한 편이라 **A(IX-Auth 판정)** 가 대체로 맞다.

### 2-4. 파일서버가 자체 권한을 가진 경우 (Nextcloud 등)

**B(위임)** 를 고른다. 리소스 종류를 만들 때 권한 관리 주체를 "저장소가 판정" 으로 둔다.

```
check(user, 'nextcloud', '/x/y.pdf', 'read')
→ { allowed: false, reason: "DELEGATED" }
```

앱은 `DELEGATED` 를 받으면 IX-Auth 대신 그 저장소에 묻는다. **`allowed:false` 를 "거부" 로 해석하지 않는다** — `reason` 을 봐야 한다.

IX-Auth 는 이 경우 **L1 권한(역할·페이지)** 만 담당한다. "파일 메뉴를 볼 수 있는가" 는 IX-Auth, "이 파일을 열 수 있는가" 는 저장소.

---

## 3. 목록 화면에서는 한 건씩 묻지 않는다

파일 100개를 보여주면서 `check` 를 100번 부르면 N+1 이다.

```js
// 요청 순서대로 판정이 돌아온다
const verdicts = await ixauth.batchCheck(userId,
  files.map(f => ({ resourceType: 'file', resourceKey: f.path, action: 'read' })))

// 또는 허용된 지점만 받아 필터링
const res = await ixauth.listResources(userId, 'file', 'read')
// res.keys 에는 '권한이 걸린 지점'(/contracts/)이 담긴다.
// 개별 파일은 그 아래로 상속되므로 목록에 직접 나오지 않는다 — 접두사로 대조한다
if (res.truncated) { /* 잘린 것이지 권한이 없는 게 아니다 */ }
```

---

## 4. 자주 겪는 문제

**권한을 줬는데 안 걸린다**
→ 리소스 **종류**가 같은지 본다. `file` 로 주고 `files` 로 물으면 걸리지 않는다. 관리 콘솔의 **판정 시험**에 같은 값을 넣어 `reason` 을 확인한다 (`NO_MATCH` 면 걸리는 권한이 없는 것).

**폴더 권한이 하위에 안 먹는다**
→ 키가 `/` 로 끝나야 폴더다. `/contracts` 는 그 이름의 파일 하나를 뜻한다.

**S3 인데 대소문자 때문에 안 걸린다**
→ 종류 설정의 대소문자 구분을 확인한다. `s3` 는 기본이 "구분 안 함" 이다.

**허용해야 하는데 거부된다**
→ 상위 어딘가에 DENY 가 걸려 있을 수 있다. **DENY 가 ALLOW 를 이긴다.** 판정 시험의 `matchedKey` 가 어느 지점에서 걸렸는지 알려준다.

**`allowed:false` 인데 `reason` 이 `DELEGATED`**
→ 거부가 아니라 "저장소가 판정한다" 는 뜻이다. 앱이 저장소에 물어야 한다.

---

## 관련 문서

- [권한 모델](permission-model.md) — L1/L2 구분, 권한 코드 문법
- [`docs/contract/authz.md`](../contract/authz.md) — 판정 규칙 계약
