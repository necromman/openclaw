# 약관 동의 붙이기 — 등록 · 버전 · 재동의

이용약관·개인정보 처리방침·마케팅 수신 동의를 IX-Auth 가 **버전과 함께 보관하고 증빙으로 남긴다.** 관리 콘솔에서 약관을 등록·게시하는 것부터 앱이 동의를 받아 넘기는 코드까지 이 문서 하나에 담았다.

> 계약 정본은 [`docs/contract/http-api.md`](../contract/http-api.md) §2-4(사용자) · §4 `/admin/terms`(관리) 다. 이 문서는 **그것을 어떻게 앱에 붙이는가**를 다룬다.

---

## 0. 먼저 이해할 것 — 필수 약관을 게시해도 로그인은 막히지 않는다

가장 많이 오해하는 지점이다. 필수 약관을 새로 게시하면 그 순간부터 전원이 재동의 대상이 되지만, **로그인 자체는 그대로 성공한다.**

```json
// POST /auth/login → 200 (토큰이 정상 발급된다)
{ "data": {
  "accessToken": "eyJ…", "refreshToken": "…", "expiresIn": 900,
  "user": { … },
  "mfaSetupRequired": false,
  "termsAgreementRequired": ["service", "privacy"]   ← 아직 동의하지 않은 필수 약관 코드
} }
```

**막지 않는 이유는 하나다 — 막으면 새 버전을 게시하는 순간 전원이 못 들어온다.** 약관을 고친 관리자 본인도 예외가 아니라서, 실수로 게시한 약관을 되돌리러 들어갈 수조차 없게 된다. 그래서 IX-Auth 는 **신호만 준다.**

**즉 강제는 앱이 한다.** `termsAgreementRequired` 가 비어 있지 않은데 앱이 그것을 무시하면, 약관 기능을 켜 놓고 아무에게도 동의를 받지 않는 상태가 된다. 이 배열이 비어야 정상 화면으로 보내고, 비어 있지 않으면 동의 화면으로 보내는 것이 앱의 책임이다.

2단계 인증의 `mfaSetupRequired` 와 **같은 방식이고 같은 이유**다.

### 두 개의 관문 — 하나는 막고 하나는 막지 않는다

| 시점 | API | 동의가 없으면 |
|------|-----|--------------|
| **가입할 때** | `POST /auth/signup` | **막는다** — `AUTH_TERMS_REQUIRED`(400)이고 **계정이 만들어지지 않는다** |
| **로그인할 때** | `POST /auth/login` · 소셜 콜백 · 매직 링크 | **막지 않는다** — 200 + `termsAgreementRequired` 배열 |

가입만 막는 이유: 계정을 만든 **뒤에** 막으면 동의하지 않은 계정이 남고, 같은 주소로 다시 가입할 수도 없게 된다. 반대로 이미 존재하는 사용자의 로그인을 막으면 위에 적은 "전원 차단" 이 일어난다. **관문의 성격이 다르다.**

### 전체 흐름

```
[가입]
① 앱  → IX-Auth   GET  /auth/terms                      ← 로그인 전에도 열린다
② 앱  → 사용자     체크박스 목록 (필수/선택 구분)
③ 앱  → IX-Auth   POST /auth/signup { …, agreements: { "service": true, "marketing": false } }
④ IX-Auth         필수가 빠졌으면 400, 계정을 만들지 않는다

[재동의]
① 앱  → IX-Auth   POST /auth/login
② IX-Auth → 앱    200 + termsAgreementRequired: ["service"]
③ 앱              토큰은 이미 받았다. 동의 화면으로 보낸다
④ 앱  → IX-Auth   POST /auth/terms/agree { agreements: { "service": true } }
⑤ IX-Auth → 앱    { recorded: 1, pending: [] }          ← pending 이 비면 화면을 닫는다
```

### 소셜 로그인에도 나간다 — 2단계 인증과 갈리는 지점

`termsAgreementRequired` 는 **카카오·Microsoft·네이버·Google 로그인 응답에도 실린다.**

| | 2단계 인증 | 약관 |
|---|-----------|------|
| 소셜 로그인에서 | 요구하지 **않는다** | **요구한다** |
| 왜 | provider 가 이미 본인확인을 마쳤다고 볼 수 있다 | 약관은 **우리와 사용자 사이의 합의**라 provider 가 대신 받아 줄 수 있는 것이 아니다 |

카카오가 자기네 약관 동의를 받았다는 사실은 우리 이용약관과 아무 관계가 없다. **앱의 소셜 콜백 처리에도 `termsAgreementRequired` 분기가 있어야 한다** — 비밀번호 로그인에만 붙여 두면 소셜로 들어온 사용자는 영영 동의 화면을 보지 못한다.

---

## 1. 약관 등록과 버전 관리

### 1-1. 관리 콘솔에서 등록한다

**관리 콘솔 → 약관 탭.** 여기서 만드는 것은 언제나 **초안**이고, `게시` 를 눌러야 사용자에게 보인다.

| 입력 | 뜻 |
|------|-----|
| **코드** | `service` · `privacy` · `marketing` 처럼 앱이 쓰는 식별자. **이미 있는 코드를 넣으면 그 약관의 다음 버전**이 된다 |
| **제목** | 화면에 뜨는 이름 (`이용약관`) |
| **필수 여부** | 필수 = 동의해야 가입하고 개정되면 재동의 · 선택 = 거절도 기록된다(마케팅 수신 등) |
| **표시 순서** | `displayOrder` 오름차순. 게시 후에도 **이것만은** 바꿀 수 있다 |
| **본문 주소** | 외부 문서를 쓸 때. 이걸 채우면 본문은 비워도 된다 |
| **본문** | 약관 전문. 본문·본문 주소 **둘 중 하나는 있어야** 한다 |

만든 뒤 표에서 `게시` 를 누른다. 확인 창이 뜨는 이유는 다음 절에 있다.

> **초안이 사용자에게 보이지 않는 이유** — 관리자가 문안을 다듬는 동안 반쯤 쓴 약관이 가입 화면에 뜨면 안 된다. `GET /auth/terms` 는 **게시본만** 준다.

### 1-2. 버전은 서버가 매긴다

같은 코드로 새 약관을 만들면 버전이 `현재 최대값 + 1` 로 자동 부여된다. **요청에 `version` 을 넣어도 무시된다.**

관리자가 직접 번호를 넣게 하면 중복이나 건너뜀이 생기고, 그러면 "이 사용자는 몇 번에 동의한 것인가" 가 흐려진다. 증빙에서 그 질문에 답하지 못하면 이력이 있으나 마나다. 초안까지 세어서 번호를 매기므로 같은 번호가 두 번 나오지 않는다.

### 1-3. 게시는 되돌릴 수 없고, 게시본은 고칠 수 없다

| 시도 | 결과 |
|------|------|
| 게시 취소 | **그런 기능이 없다.** 이미 본 사람과 동의한 사람을 없던 일로 할 수 없다 |
| 게시본의 제목·본문·필수 여부 수정 | `CONFLICT`(409) — *"게시된 약관의 내용은 고칠 수 없습니다. 새 버전으로 게시하세요."* |
| 게시본의 표시 순서 변경 | 된다. 내용이 아니라 배치일 뿐이다 |
| 이미 게시된 것을 다시 게시 | `CONFLICT`(409) |

**내용을 고치면 이미 동의한 사람의 이력이 가리키는 대상이 달라진다.** "이 사용자는 `service` v3 에 동의했다" 는 기록이 있는데 v3 의 본문이 나중에 바뀌면, 그 기록은 무엇에 대한 동의인지를 더 이상 말해 주지 않는다. 오타 하나라도 **새 버전**으로 낸다.

### 1-4. 새 버전을 게시하면 재동의를 요구한다

`ixauth.terms.reagreement-required` 가 켜져 있으면(기본), 필수 약관의 새 버전이 게시되는 순간부터 **v3 에만 동의한 사용자의 로그인 응답에 `termsAgreementRequired: ["service"]` 가 실린다.**

판정은 이렇게 한다.

```
그 코드에 대한 사용자의 마지막 응답이
   ① 존재하고
   ② agreed = true 이고
   ③ (재동의 요구가 켜져 있다면) 동의한 버전 >= 현재 게시 버전
→ 셋을 다 만족하면 통과. 하나라도 아니면 pending 에 들어간다
```

- **마지막 응답만 본다.** 동의했다가 나중에 철회(`agreed: false`)했다면 다시 pending 이다
- **선택 약관은 절대 pending 에 들어가지 않는다.** 마케팅 수신 동의를 새 버전으로 올려도 로그인 응답은 조용하다 — 선택 약관의 재동의를 받고 싶으면 앱이 `GET /auth/terms` 의 버전과 `GET /auth/terms/agreements` 의 버전을 비교해 직접 화면을 띄운다

`reagreement-required` 를 끄면 한 번 동의한 사람은 개정돼도 다시 묻지 않는다. 다만 그 상태는 **개정된 내용에 동의받은 적이 없다**는 뜻이라 증빙이 되지 않는다.

### 1-5. 관리 API

관리 콘솔이 쓰는 것과 같은 API 다. 배포 스크립트로 약관을 넣을 때 쓴다.

| 메서드 | 경로 | 필요 권한 |
|--------|------|----------|
| GET | `/admin/terms` (초안 포함 전량) | `ixauth:users:read` |
| GET | `/admin/terms/{id}` | `ixauth:users:read` |
| POST | `/admin/terms` (새 약관 · 새 버전) | `ixauth:users:write` |
| PATCH | `/admin/terms/{id}` | `ixauth:users:write` |
| POST | `/admin/terms/{id}/publish` | `ixauth:users:write` |
| DELETE | `/admin/terms/{id}` | `ixauth:users:write` |
| GET | `/admin/terms/{id}/agreements?page=&size=` | `ixauth:users:read` |

```bash
# ① 초안 만들기 — version 은 넣어도 무시된다
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  https://ix-auth/admin/terms -d '{
    "code": "service", "title": "이용약관",
    "body": "제1조 (목적) …",
    "required": true, "displayOrder": 0
  }'
# {"data":{"id":7,"code":"service","version":4,"publishedAt":null,"agreementCount":0, …}}

# ② 게시 — 이때부터 사용자에게 보이고, 필수라면 재동의 대상이 된다
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ix-auth/admin/terms/7/publish
```

`required` 를 생략하면 **`true`(필수)** 다. `body` 대신 `bodyUrl` 만 채워도 되지만 **둘 다 비면** `VALIDATION_FAILED`(400) 다.

---

## 2. 동의 이력은 지우지 않는다

이 기능이 존재하는 이유가 여기에 있다. 동의 이력은 **법적 증빙**이라, 지울 수 있는 경로가 하나라도 있으면 그 순간 증빙이 아니게 된다.

- **수정·삭제 API 가 없다.** 관리 콘솔에도, HTTP API 에도, 리포지토리 코드에도 없다 — 감사 로그와 같은 취급이다
- **철회는 덮어쓰기가 아니라 `agreed: false` 인 새 행**이다. 덮어쓰면 "언제부터 언제까지 동의 상태였는가" 가 사라지는데, 증빙에서 필요한 것이 바로 그 구간이다
- 동의 시각과 함께 **IP · User-Agent · 약관 버전**을 남긴다 (`GET /admin/terms/{id}/agreements` 에서 조회)
- **동의 이력이 한 건이라도 있는 약관은 삭제되지 않는다** — `CONFLICT`(409) *"동의 이력이 N건 있어 삭제할 수 없습니다. 증빙은 지우지 않습니다."* 삭제는 오타 난 초안을 치우는 용도다
- `ixauth.terms.enabled` 를 **꺼도 등록된 약관과 이력은 지우지 않는다.** 기능을 잠시 껐다고 증빙이 사라지면 안 된다

사용자 본인도 자기 이력을 볼 수 있다.

```json
// GET /auth/terms/agreements   (access token)
{ "data": { "items": [
  { "code": "service",   "version": 3, "agreed": true,  "agreedAt": "2026-08-08T11:20:00Z" },
  { "code": "service",   "version": 2, "agreed": true,  "agreedAt": "2026-03-02T09:10:00Z" },
  { "code": "marketing", "version": 1, "agreed": false, "agreedAt": "2026-03-02T09:10:00Z" }
] } }
```

옛 버전에 동의한 기록도, 거절한 기록도 그대로 나온다 — 그것이 이 목록의 쓸모다.

---

## 3. IX-Auth 설정

```yaml
ixauth:
  terms:
    enabled: true                 # 기본 false — 켜지 않으면 아무 신호도 나가지 않는다
    require-on-signup: true       # 가입 요청에 필수 동의가 없으면 400
    reagreement-required: true    # 새 버전이 게시되면 다시 받는다
```

| 키 | 기본값 | 뜻 |
|----|--------|-----|
| `enabled` | **`false`** | 기능 전체 스위치. 끄면 `GET /auth/terms` 가 빈 배열이고 `termsAgreementRequired` 도 항상 비어 있다 |
| `require-on-signup` | `true` | 가입 요청에 필수 약관 동의가 없으면 `AUTH_TERMS_REQUIRED`(400) |
| `reagreement-required` | `true` | 필수 약관이 새 버전으로 게시되면 다시 받는다 |

셋 다 **관리 콘솔 → 설정 탭 → "약관" 그룹**에서 재시작 없이 바꿀 수 있다. `enabled` 가 꺼져 있으면 나머지 둘은 화면에 나오지 않는다.

**기본이 꺼짐인 이유** — 대외 서비스에는 사실상 필수이고, **사내 인스턴스에는 받을 약관 자체가 없다.** 같은 jar 하나로 둘 다 덮으려면 기능 전체가 스위치여야 한다.

⚠ **약관 탭에서 등록·게시를 마쳐도 `enabled` 가 꺼져 있으면 사용자에게 아무것도 나가지 않는다.** 등록은 되는데 가입 화면이 비어 있다면 여기를 먼저 본다.

---

## 4. 앱 구현

### 4-1. ⚠ SDK 에는 약관 함수가 없다 — `signup()` 도 `agreements` 를 보내지 않는다

`@ix-auth/client-node` 와 `ix-auth-client`(Python) **둘 다 약관 관련 함수를 제공하지 않는다.** 그리고 더 조용한 함정이 하나 있다.

```js
// packages/client-node/src/client.js
signup: (email, password, name) =>
  call('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
//                                                    ↑ agreements 가 없다
```

Python 의 `signup(email, password, name)` 도 같다. **SDK 의 `signup()` 을 그대로 쓰면 동의를 아무리 잘 받아도 서버로 전달되지 않는다.** `require-on-signup` 이 켜져 있으면 `AUTH_TERMS_REQUIRED`(400) 로 막히고, 꺼져 있으면 조용히 동의 없는 계정이 만들어진다.

약관을 쓰는 앱은 **가입과 약관 경로만 직접 호출**한다.

```js
// ixauth-http.js
const BASE = process.env.IXAUTH_BASE_URL
const KEY = process.env.IXAUTH_SERVICE_KEY

export async function ixauthFetch(path, { accessToken, ...init } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-IxAuth-Key': KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(body?.error?.message ?? `IX-Auth 호출 실패 (${res.status})`)
    err.status = res.status
    err.code = body?.error?.code ?? 'INTERNAL'
    err.details = body?.error?.details ?? null   // ← 어떤 약관이 빠졌는지가 여기 있다
    throw err
  }
  return body?.data ?? null
}
```

### 4-2. 가입 화면 — 목록을 물어서 그린다

```js
// 로그인 전 화면이 쓰는 경로다. access token 을 요구하지 않는다
app.get('/api/terms', async (_req, res) => {
  res.json(await ixauthFetch('/auth/terms'))
})
```

```json
// GET /auth/terms 응답
{ "data": { "items": [
  { "code": "service", "version": 3, "title": "이용약관",
    "body": "제1조 …", "bodyUrl": null, "required": true, "displayOrder": 0 },
  { "code": "marketing", "version": 1, "title": "마케팅 정보 수신",
    "body": null, "bodyUrl": "https://myapp/terms/marketing",
    "required": false, "displayOrder": 9 }
] } }
```

**access token 을 요구하지 않는 이유** — 가입 화면은 로그인 전에 뜬다. 토큰을 요구하면 가입하려는 사람이 약관을 읽을 수 없다. 게시된 약관은 어차피 공개 문서라 감출 것이 없다.

**약관 목록을 앱에 하드코딩하지 않는다.** 코드·제목·필수 여부를 화면에 박아 두면, 관리자가 새 약관을 추가하거나 필수 여부를 바꿔도 화면이 따라가지 않는다. `body` 가 있으면 그리고, 없으면 `bodyUrl` 을 새 창으로 연다.

```tsx
const [terms, setTerms] = useState<Term[]>([])
const [agreed, setAgreed] = useState<Record<string, boolean>>({})

useEffect(() => {
  fetch('/api/terms').then(r => r.json()).then(d => setTerms(d.items ?? []))
}, [])

// 기능이 꺼져 있거나 게시된 약관이 없으면 items 가 빈 배열이다.
// 앱은 "약관 기능이 켜졌는가" 를 따로 물을 필요 없이 비면 이 단계를 건너뛴다
const canSubmit = terms.filter(t => t.required).every(t => agreed[t.code])

return (
  <>
    {terms.map(t => (
      <label key={t.code}>
        <input type="checkbox" checked={!!agreed[t.code]}
               onChange={e => setAgreed({ ...agreed, [t.code]: e.target.checked })} />
        [{t.required ? '필수' : '선택'}] {t.title}
        {t.body
          ? <button type="button" onClick={() => openModal(t.body)}>보기</button>
          : <a href={t.bodyUrl!} target="_blank" rel="noreferrer">보기</a>}
      </label>
    ))}
    <button disabled={!canSubmit} onClick={submit}>가입</button>
  </>
)
```

가입 요청은 이렇게 나간다.

```js
app.post('/api/signup', async (req, res) => {
  try {
    await ixauthFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: req.body.email,
        password: req.body.password,
        name: req.body.name,
        // 약관 코드 → 동의 여부. 버전은 보내지 않는다
        agreements: req.body.agreements,   // { "service": true, "marketing": false }
      }),
    })
    res.json({ accepted: true })
  } catch (e) {
    if (e.code === 'AUTH_TERMS_REQUIRED') {
      // details[].field 가 "agreements.<code>" 다 — 그 체크박스를 짚어 준다
      return res.status(400).json({ error: 'terms', details: e.details })
    }
    throw e
  }
})
```

**`agreements` 에 버전을 보내지 않는다.** 서버가 현재 게시본으로 정한다 — 클라이언트가 보낸 버전을 믿으면 옛 버전에 동의한 것으로 기록해 재동의를 회피할 수 있다. 화면에 보이는 `version` 은 사용자에게 표시하는 용도이지 되돌려 보낼 값이 아니다.

필수 약관이 빠졌을 때의 응답은 이렇다.

```json
{ "error": { "code": "AUTH_TERMS_REQUIRED", "message": "필수 약관에 동의해야 합니다.",
  "traceId": "0f4c…",
  "details": [ { "field": "agreements.service", "reason": "필수 약관입니다." } ] } }
```

**계정은 만들어지지 않았다.** 사용자가 체크박스를 채우고 같은 요청을 다시 보내면 된다.

### 4-3. 로그인 후 재동의

```js
function setSession(res, r) {
  res.cookie('ixauth_at', r.accessToken, { httpOnly: true, sameSite: 'lax', secure: true })
  res.cookie('ixauth_rt', r.refreshToken, { httpOnly: true, sameSite: 'lax', secure: true })

  // 강제는 앱이 한다. 서버는 신호만 준다
  if (r.mfaSetupRequired) return res.json({ step: 'mfa-setup' })
  if (r.termsAgreementRequired?.length) {
    return res.json({ step: 'terms', codes: r.termsAgreementRequired })
  }
  return res.json({ step: 'done' })
}

// 동의 화면이 부르는 경로 — access token 이 필요하다
app.post('/api/terms/agree', authenticated, async (req, res) => {
  try {
    const d = await ixauthFetch('/auth/terms/agree', {
      method: 'POST', accessToken: req.cookies.ixauth_at,
      // ⚠ 최상위 키는 반드시 "agreements" 다
      body: JSON.stringify({ agreements: req.body.agreements }),
    })
    // { recorded: 2, pending: [] }
    res.json(d)
  } catch (e) {
    if (e.code === 'AUTH_TERMS_REQUIRED') {
      // 필수 약관에 false 를 보냈다 — 거절할 수 없다
      return res.status(400).json({ error: 'terms', details: e.details })
    }
    throw e
  }
})
```

요청 형식을 정확히 옮긴다. **필드 이름을 틀리면 400 도 나지 않고 조용히 아무것도 기록되지 않는다** (4-5 참조).

```json
// POST /auth/terms/agree      Authorization: Bearer <access token>
{ "agreements": { "service": true, "marketing": false } }

// 200
{ "data": { "recorded": 2, "pending": [] } }
```

| 응답 필드 | 뜻 |
|----------|-----|
| `recorded` | 실제로 남긴 이력 건수. **보낸 개수보다 작을 수 있다**(게시되지 않은 코드는 버려진다) |
| `pending` | **이 요청 뒤에도 남은 필수 코드.** 비어야 앱이 동의 화면을 닫는다 |

**`pending` 을 보고 화면을 닫는다.** 로그인 응답의 `termsAgreementRequired` 를 그대로 믿고 닫으면, 그 사이에 관리자가 약관을 하나 더 게시한 경우 화면이 어긋난다. 다음 로그인까지 기다리게 하지 않으려고 이 값을 응답에 실어 준다.

화면 쪽은 가입 화면과 같은 컴포넌트를 재사용하되, **`termsAgreementRequired` 에 있는 코드만** 필수로 취급하면 된다.

```tsx
// 로그인 응답이 { step: 'terms', codes: ['service'] } 였을 때
const required = new Set(codes)

async function submit() {
  const d = await fetch('/api/terms/agree', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agreements: agreed }),
  }).then(r => r.json())

  if (d.pending?.length) return setCodes(d.pending)   // 아직 남았다
  navigate('/')                                        // 비었으면 통과
}
```

### 4-4. 어디서 막을 것인가

동의 화면을 **어디에 두느냐**가 실제 강제력을 정한다.

| 방식 | 강제력 | 언제 쓰나 |
|------|-------|----------|
| 로그인 직후 리다이렉트만 | 약하다 — 사용자가 URL 을 직접 치면 넘어간다 | 데모·내부 도구 |
| **BFF 미들웨어에서 막는다** | 강하다 | 대부분의 경우 권장 |
| 서비스 API 전부에서 검사 | 가장 강하지만 비싸다 | 결제 등 특정 경로만 추가로 |

BFF 에서 막는 쪽을 권한다. 토큰은 이미 발급됐으므로 **앱이 자기 라우터에서 게이트를 세우는 것 말고는 막을 방법이 없다.**

```js
// 로그인 시점에 pending 을 세션에 적어 두고, 그 세션으로 들어오는 요청을 막는다
app.use('/api', (req, res, next) => {
  if (!req.session.termsPending?.length) return next()
  // 동의 화면 자체와 로그아웃은 열어 둔다 — 안 그러면 사용자가 아무것도 못 한다
  if (req.path.startsWith('/terms') || req.path === '/logout') return next()
  return res.status(403).json({ error: 'terms-required', codes: req.session.termsPending })
})
```

**동의 화면으로 가는 경로와 로그아웃은 반드시 열어 둔다.** 전부 막으면 사용자가 동의할 방법조차 없는 상태에 갇힌다 — 실제로 가장 흔한 사고다.

세션에 적어 둔 `termsPending` 은 `/auth/terms/agree` 의 응답 `pending` 으로 갱신한다. 로그인 응답만 믿고 갱신하지 않으면 동의를 마쳐도 게이트가 계속 막는다.

### 4-5. Python / FastAPI

```python
import httpx

def ixauth_call(method: str, path: str, *, access_token: str | None = None, **kw):
    headers = {"X-IxAuth-Key": os.environ["IXAUTH_SERVICE_KEY"]}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    with httpx.Client(timeout=10.0) as c:
        res = c.request(method, f"{os.environ['IXAUTH_BASE_URL']}{path}",
                        headers=headers, **kw)
    body = res.json() if res.content else {}
    if res.status_code >= 400:
        err = body.get("error") or {}
        raise IxAuthApiError(err.get("code"), err.get("message"),
                             res.status_code, err.get("details") or [])
    return body.get("data")


@app.get("/api/terms")
async def terms():
    return ixauth_call("GET", "/auth/terms")


@app.post("/api/signup")
async def signup(body: SignupBody):
    # SDK 의 signup() 은 agreements 를 보내지 않는다 — 직접 부른다
    ixauth_call("POST", "/auth/signup", json={
        "email": body.email, "password": body.password, "name": body.name,
        "agreements": body.agreements,      # {"service": True, "marketing": False}
    })
    return {"accepted": True}


@app.post("/api/terms/agree")
async def agree(req: Request, body: AgreeBody):
    return ixauth_call("POST", "/auth/terms/agree",
                       access_token=req.cookies["ixauth_at"],
                       json={"agreements": body.agreements})
```

---

## 5. 자주 겪는 문제

### 5-1. 동의했는데 `termsAgreementRequired` 가 사라지지 않는다

거의 항상 **요청 형식**이다. 이 API 는 모르는 코드를 400 으로 막지 않기 때문에, 틀려도 200 이 돌아와 **성공한 것처럼 보인다.**

| 보낸 것 | 결과 |
|---------|------|
| `{ "service": true }` | 최상위 키가 `agreements` 가 아니다 → 본문이 통째로 무시되고 `recorded: 0` |
| `{ "agreements": ["service"] }` | 배열이 아니라 **객체**여야 한다 → 아무것도 기록되지 않는다 |
| `{ "agreements": { "service": "true" } }` | 문자열 `"true"` 는 `true` 가 아니다 → **거절로 기록**되거나 필수면 400 |
| `{ "agreements": { "Service": true } }` | 코드는 **대소문자를 구분한다** → 게시되지 않은 코드로 보고 버린다 |
| `{ "agreements": { "service": true, "version": 3 } }` | `version` 이라는 코드의 약관이 없으므로 버려진다. 버전은 애초에 보내지 않는다 |

**진단은 응답의 `recorded` 로 한다.** 보낸 개수와 다르면 그 차이만큼 버려진 것이다. `recorded: 0` 인데 200 이면 형식이 틀렸거나 `terms.enabled` 가 꺼져 있다.

```bash
curl -X POST -H "Authorization: Bearer $AT" -H "X-IxAuth-Key: $KEY" \
     -H 'Content-Type: application/json' \
     https://ix-auth/auth/terms/agree -d '{"agreements":{"service":true}}'
# {"data":{"recorded":1,"pending":[]}}     ← recorded 가 1 이어야 정상
```

### 5-2. 모르는 코드는 조용히 버려진다

게시되지 않은 코드, 오타 난 코드, 삭제된 코드에 대한 동의는 **400 이 아니라 무시**다. `recorded` 가 보낸 개수보다 작아질 뿐이다.

400 으로 막으면 앱이 옛 코드를 하나 남겨 둔 것만으로 **동의 전체가 실패**하고, 그러면 그 앱을 배포하기 전까지 아무도 가입할 수 없게 된다. 관대하게 받는 쪽이 사고가 작다.

대신 **앱이 코드를 하드코딩하면 이 관대함이 조용한 실패로 돌아온다.** 목록은 항상 `GET /auth/terms` 로 받아서 그린다.

### 5-3. 필수 약관을 거절했다

```json
// POST /auth/terms/agree  { "agreements": { "service": false } }  → 400
{ "error": { "code": "AUTH_TERMS_REQUIRED", "message": "필수 약관에 동의해야 합니다.",
  "details": [ { "field": "agreements.service", "reason": "필수 약관은 거절할 수 없습니다." } ] } }
```

필수 약관에 `false` 를 보내면 400 이다. 화면에서 필수 체크박스를 해제한 채로 제출 버튼을 누를 수 없게 막는 것이 먼저이고, 이 응답은 그것을 우회했을 때의 마지막 방어선이다.

**선택 약관의 거절은 정상적으로 기록된다.** 마케팅 수신 거부는 지켜야 할 의사 표시라 `agreed: false` 행으로 남는다 — 보내지 않는 것과 `false` 로 보내는 것은 다르다. 아무것도 보내지 않으면 "답하지 않았다" 이고, `false` 는 "거절했다" 이다.

### 5-4. `terms.enabled` 가 꺼져 있으면 전부 조용하다

| 호출 | 꺼져 있을 때 |
|------|-------------|
| `GET /auth/terms` | `{"items": []}` — 200 |
| `POST /auth/terms/agree` | `{"recorded": 0, "pending": []}` — 200. **아무것도 기록되지 않는다** |
| `POST /auth/signup` 의 `agreements` | 검사도 기록도 하지 않는다 |
| 로그인의 `termsAgreementRequired` | 항상 `[]` |

**에러가 아니라 무응답**이라 개발 중에 알아채기 어렵다. 약관이 동작하지 않으면 관리 콘솔 → 설정 탭 → 약관 → `terms.enabled` 를 가장 먼저 본다. 기본값이 `false` 라는 점을 기억한다.

### 5-5. 소셜 로그인 사용자가 동의 화면을 못 본다

`termsAgreementRequired` 는 소셜 콜백 응답에도 실리는데, 앱이 소셜 경로에서만 `setSession()` 을 거치지 않고 곧바로 리다이렉트하는 경우가 흔하다. **로그인·소셜 콜백·매직 링크 세 경로가 같은 후처리 함수를 지나게** 만든다 — 응답 모양이 셋 다 같으므로 함수 하나면 된다.

2단계 인증과 헷갈리지 않는다. **2단계는 소셜에서 요구하지 않지만 약관은 요구한다.**

### 5-6. 게시했는데 가입 화면에 안 나온다

순서대로 확인한다.

1. `terms.enabled` 가 켜져 있는가 (기본 `false`)
2. **초안이 아니라 게시본인가** — `GET /admin/terms` 의 `publishedAt` 이 `null` 이면 초안이다
3. 같은 코드의 **더 높은 게시 버전**이 이미 있는가 — `GET /auth/terms` 는 코드마다 **최신 게시본 하나만** 준다. v5 를 게시하면 v4 는 목록에서 사라진다
4. 앱이 목록을 캐시하고 있지 않은가

### 5-7. 약관을 지우려는데 409 가 난다

*"동의 이력이 N건 있어 삭제할 수 없습니다."* — **정상 동작이다.** 삭제는 오타 난 초안을 치우는 용도이지 게시 이력을 지우는 용도가 아니다.

잘못 게시한 약관은 **고친 새 버전을 내는 것**이 유일한 정정 방법이다. 게시 취소도, 이력 삭제도 없다.

### 5-8. 선택 약관의 재동의를 받고 싶다

`termsAgreementRequired` 에는 **필수 약관만** 들어간다. 마케팅 수신 동의를 v2 로 올려도 로그인 응답은 조용하다.

선택 약관의 재동의가 필요하면 앱이 직접 비교한다.

```js
const [current, mine] = await Promise.all([
  ixauthFetch('/auth/terms'),                                    // 게시본 (버전 포함)
  ixauthFetch('/auth/terms/agreements', { accessToken: at }),    // 내 이력
])
const latestMine = new Map()          // 코드 → 최신 응답 (items 는 최근순이다)
for (const a of mine.items) if (!latestMine.has(a.code)) latestMine.set(a.code, a)

const askAgain = current.items.filter(t => {
  if (t.required) return false                       // 필수는 서버가 알려 준다
  const a = latestMine.get(t.code)
  return !a || a.version < t.version                 // 답한 적 없거나 옛 버전이다
})
```

**강제하지는 않는다.** 선택 약관은 거절도 정당한 답이므로, 배너나 설정 화면에서 다시 물어보는 정도가 맞다.

---

## 6. 운영 점검 목록

| | 확인 |
|---|------|
| ☐ | `ixauth.terms.enabled` 가 켜져 있는가 — **기본이 `false`** 다 |
| ☐ | 앱이 `termsAgreementRequired` 를 보고 동의 화면으로 보내는가 — 안 보면 재동의가 강제되지 않는다 |
| ☐ | **소셜 로그인 콜백 처리에도** 같은 분기가 있는가 |
| ☐ | 가입 요청이 `agreements` 를 **실제로** 보내는가 (SDK 의 `signup()` 은 보내지 않는다) |
| ☐ | 요청 본문의 최상위 키가 `agreements` 이고 값이 **객체 · 불리언**인가 |
| ☐ | 동의 화면을 앱이 **약관 목록을 물어서** 그리는가 (코드·제목 하드코딩 금지) |
| ☐ | 게이트에서 **동의 화면과 로그아웃 경로는 열어 두었는가** |
| ☐ | 동의 후 `pending` 으로 세션 상태를 갱신하는가 (로그인 응답만 믿지 않는다) |
| ☐ | 게시 전에 문안을 확정했는가 — **게시 취소도 내용 수정도 없다** |
| ☐ | 필수/선택 구분이 의도한 대로인가 — 선택은 재동의 신호가 나가지 않는다 |
| ☐ | 개정할 때 기존 행을 고치지 않고 **새 버전**으로 내고 있는가 |
| ☐ | `reagreement-required` 를 껐다면, 개정된 내용에 동의받은 적이 없다는 사실을 감수한 것인가 |
| ☐ | 동의 이력 백업이 DB 백업에 포함되는가 (지울 수 없게 만들어 둔 것이 백업 누락으로 사라지면 의미가 없다) |

---

## 관련 문서

- 계약: [`docs/contract/http-api.md`](../contract/http-api.md) §2-4(사용자) · §2-1(가입 요청 본문) · §4 `/admin/terms`(관리)
- 설정: [`docs/contract/config.md`](../contract/config.md) §5-5
- 에러 코드: [`docs/contract/errors.md`](../contract/errors.md) — `AUTH_TERMS_REQUIRED`
- 함께 보는 신호: [`2단계 인증 가이드`](mfa.md) — `mfaSetupRequired` 도 같은 방식으로 동작한다
