# 2단계 인증(TOTP) 붙이기 — 등록 · 로그인 · 해제

인증 앱(Google Authenticator · Microsoft Authenticator · 1Password 등)이 30초마다 만드는 6자리 코드를 로그인에 한 번 더 받는 기능이다. IX-Auth 설정 → 앱 코드 → 운영 순으로 이 문서 하나에 담았다.

> 계약 정본은 [`docs/contract/http-api.md`](../contract/http-api.md) §2-3 이다. 이 문서는 **그것을 어떻게 앱에 붙이는가**를 다룬다.

---

## 0. 먼저 이해할 것 — 화면은 앱이 만든다

IX-Auth 는 화면을 만들지 않는다(설계 불변식 1). 2단계 인증에서 이 불변식은 **앱이 화면 셋을 만들어야 한다**는 뜻이 된다.

| 화면 | 언제 뜨나 | 앱이 그려야 하는 것 |
|------|----------|-------------------|
| ① **등록** | 사용자가 "2단계 인증 켜기" 를 눌렀을 때 | QR 코드(또는 시크릿 문자열) + **백업 코드 목록** + 코드 입력 칸 |
| ② **로그인 2단계** | 로그인 응답이 `AUTH_MFA_REQUIRED` 일 때 | 6자리 코드 입력 칸 (백업 코드도 여기에 넣는다) |
| ③ **해제** | 사용자가 "끄기" 를 눌렀을 때 | 현재 비밀번호 입력 칸 |

세 화면 모두 IX-Auth 가 대신 띄워 주지 않는다. jar 는 외부에 노출되지 않으므로(설계 불변식 4) 브라우저가 직접 열 주소 자체가 없다.

### QR 은 앱이 그린다

IX-Auth 가 주는 것은 **`otpauth://` URI 문자열 하나**다. 이미지가 아니다.

```
otpauth://totp/IX-Auth:chris%40prost.team?secret=JBSWY3DPEHPK3PXP&issuer=IX-Auth&algorithm=SHA1&digits=6&period=30
```

QR 라이브러리는 앱이 고른다 — 예를 들어 `npm i qrcode` 후 `const dataUrl = await QRCode.toDataURL(otpauthUri)` 한 줄이면 `<img src={dataUrl}>` 로 그릴 수 있다.

**이미지를 서버가 만들지 않는 이유**: PNG 를 응답에 실으면 그 응답이 곧 시크릿이라 로그·프록시 캐시·모니터링 스크린샷 어디에든 남을 수 있고, 앱마다 다른 크기·색·다크모드 요구를 서버가 떠안게 된다. 문자열은 앱이 원하는 대로 그린다. 스캔이 안 되는 환경(데스크톱 인증 앱)을 위해 **`secret=` 값을 그대로 보여 주는 "직접 입력" 경로**도 함께 두는 편이 좋다.

### 전체 흐름

**등록 — `setup` 과 `confirm` 이 나뉘어 있다.**

```
① 앱  → IX-Auth   POST /auth/mfa/totp/setup        (access token, 본문 없음)
② IX-Auth → 앱    { otpauthUri, backupCodes[10] }   ← 백업 코드 평문은 이때 한 번뿐
③ 앱  → 사용자     QR 을 그려 보여 준다 + 백업 코드를 저장하게 한다
④ 사용자 → 인증 앱  스캔 → 6자리 코드가 뜬다
⑤ 앱  → IX-Auth   POST /auth/mfa/totp/confirm { code: "492013" }
⑥ IX-Auth         코드가 맞으면 **이때 켜진다**
```

**⑤ 전에는 로그인에 아무 영향이 없다.** 이 분리가 없으면 QR 을 잘못 스캔했거나 시계가 틀어진 사람이 등록을 누른 그 순간부터 자기 계정에서 잠긴다. `confirm` 은 "인증 앱이 실제로 이 시크릿으로 코드를 만든다" 를 증명하는 절차다.

**로그인 — 한 번의 요청이 두 번으로 갈라진다.**

```
① 앱  → IX-Auth   POST /auth/login { email, password }
② IX-Auth → 앱    401  AUTH_MFA_REQUIRED
                  error.meta = { challenge: "qTci9f…", expiresIn: 300 }
③ 앱  → 사용자     2단계 코드 입력 화면 (challenge 는 서버 세션에 보관)
④ 사용자 → 앱      "492013"  (또는 백업 코드 "4KQ2M-9XTVB")
⑤ 앱  → IX-Auth   POST /auth/mfa/verify { challenge, code }
⑥ IX-Auth → 앱    /auth/login 200 과 똑같은 모양 (accessToken · refreshToken · user)
⑦ 앱              토큰을 HttpOnly 쿠키로 심는다
```

**⑤의 응답이 `/auth/login` 200 과 같은 모양이라는 점이 중요하다.** 로그인 성공 후처리(쿠키 심기 · 리다이렉트 · `mfaSetupRequired` / `termsAgreementRequired` 확인)를 두 벌로 만들 필요가 없다 — 한 함수로 묶고 양쪽에서 부른다.

---

## 1. IX-Auth 설정

### 1-1. 설정 키

```yaml
ixauth:
  mfa:
    # 누구에게 요구할 것인가
    mode: OPTIONAL              # OPTIONAL | REQUIRED_ADMIN | REQUIRED_ALL

    # 등록할 때 한 번만 보여 주는 1회용 코드 수. 0 으로 두지 않는다
    backup-code-count: 10

    # 사용자의 인증 앱 목록에 표시될 이름. 비우면 mail.product-name 을 쓴다
    issuer: ""

    # 비밀번호가 맞은 뒤 코드를 넣기까지 허용할 시간
    challenge-ttl: 5m

    # 관리자가 남의 2단계를 초기화할 수 있는가
    admin-reset: true

    # 민감 작업에 코드를 한 번 더 요구한다 (기본: 요구하지 않음)
    step-up-actions: []

    # ⚠ 시크릿 — 환경변수로만 준다
    encryption-key: ${IXAUTH_MFA_ENCRYPTION_KEY}
```

| 키 | 기본값 | 뜻 |
|----|--------|-----|
| `mode` | `OPTIONAL` | `OPTIONAL` 사용자가 스스로 켠다 · `REQUIRED_ADMIN` `ixauth:*` 권한을 가진 사람은 필수 · `REQUIRED_ALL` 전원 필수 |
| `backup-code-count` | `10` | 등록 시 함께 발급되는 1회용 코드 수 |
| `issuer` | (비움) | 인증 앱 목록의 이름. 비우면 `ixauth.mail.product-name` |
| `challenge-ttl` | `5m` | challenge 수명. 이 시간이 지나면 로그인부터 다시 |
| `admin-reset` | `true` | `POST /admin/users/{id}/mfa-reset` 허용 여부. `false` 면 그 API 가 403 |
| `step-up-actions` | (비움) | 민감 작업 재인증 — `PASSWORD_CHANGE` · `EMAIL_CHANGE` · `ACCOUNT_DELETE` · `MFA_DISABLE` |
| `encryption-key` | (비움) | TOTP 시크릿 암호화 키. **환경변수 `IXAUTH_MFA_ENCRYPTION_KEY` 로만** 준다 |

`mode` · `backup-code-count` · `issuer` · `challenge-ttl` · `admin-reset` 은 **관리 콘솔 → 설정 탭 → "2단계 인증" 그룹**에서 재시작 없이 바꿀 수 있다. `encryption-key` 와 `step-up-actions` 중 시크릿에 해당하는 값은 화면에 나오지 않는다.

### 1-2. 알고리즘 파라미터는 설정에 없다

SHA-1 · 30초 · 6자리 · 오차 ±1스텝은 **설정으로 뺄 수 없게 만들어 두었다.** 고객사마다 다를 수 있는 정책이 아니라 인증 앱과 맞아야 하는 규격이기 때문이다 — 바꾸면 대부분의 인증 앱이 코드를 만들지 못한다.

### 1-3. ⚠ `encryption-key` 를 비우면 `service-key` 에서 파생한다

그 상태로 운영하다 **`ixauth.service-key` 를 교체하면 등록된 TOTP 가 전부 무효**가 된다. 사용자는 백업 코드로 들어와 다시 등록해야 하고, 백업 코드까지 없으면 관리자 초기화가 유일한 경로다. 운영에서는 `IXAUTH_MFA_ENCRYPTION_KEY` 를 따로 주고, 그 값을 **service-key 와 다른 수명으로 관리**한다.

### 1-4. `REQUIRED_*` 는 로그인을 막지 않는다 — 강제는 앱의 몫이다

`mode` 를 `REQUIRED_ADMIN` · `REQUIRED_ALL` 로 바꿔도, **아직 등록하지 않은 사람의 로그인은 그대로 성공한다.** 대신 응답에 신호가 실린다.

```json
{ "data": { "accessToken": "eyJ…", "refreshToken": "…", "expiresIn": 900,
            "user": { … },
            "mfaSetupRequired": true,            ← 이 값이 참이면 등록 화면으로 보낸다
            "termsAgreementRequired": [] } }
```

막지 않는 이유는 둘이다.

- **막으면 설정을 바꾼 순간 전원이 잠긴다.** 등록한 사람이 아무도 없는 상태에서 `REQUIRED_ALL` 을 켜면, 그 설정을 되돌릴 관리자조차 들어올 수 없다
- 앱은 토큰을 **로컬 검증**하므로(설계 불변식 2), jar 가 "제한된 토큰" 을 발급해 봐야 그 제한을 실제로 강제할 주체는 결국 앱이다

**그래서 `mfaSetupRequired: true` 를 무시하는 앱에서는 `REQUIRED_ALL` 이 아무 효력도 없다.** 이 설정은 "요구한다" 는 선언이고, 문을 잠그는 것은 앱이 한다. 같은 판단은 `GET /auth/mfa/status` 의 `setupRequired` 로 언제든 다시 물을 수 있다.

```json
// GET /auth/mfa/status   (access token)
{ "data": { "enabled": false, "type": "TOTP", "backupCodesRemaining": 0,
            "pendingConfirm": false, "mode": "REQUIRED_ALL", "setupRequired": true } }
```

| 필드 | 뜻 |
|------|-----|
| `enabled` | 확인까지 끝나 **실제로 켜져 있다** |
| `pendingConfirm` | `setup` 은 했는데 `confirm` 을 안 했다 — 로그인에는 영향이 없는 상태 |
| `backupCodesRemaining` | 남은 백업 코드 수. 켜져 있지 않으면 `0` |
| `mode` | 현재 서버 설정 |
| `setupRequired` | 필수인데 아직 등록하지 않았다 |

---

## 2. 앱 구현

### 2-1. ⚠ SDK 에는 MFA 함수가 없다 — 그리고 SDK 로는 challenge 를 받을 수 없다

`@ix-auth/client-node` 와 `ix-auth-client`(Python) **둘 다 2단계 인증 관련 함수를 제공하지 않는다.** 아래 코드는 전부 HTTP 직접 호출이다.

그보다 중요한 함정이 하나 더 있다. **두 SDK 모두 에러 응답의 `meta` 를 버린다.**

```js
// packages/client-node/src/client.js — 에러를 만드는 부분
const err = new Error(body?.error?.message ?? `IX-Auth 호출 실패 (${res.status})`)
err.status = res.status
err.code = body?.error?.code ?? 'INTERNAL'
throw err                       // ← body.error.meta 가 여기서 사라진다
```

challenge 는 `error.meta.challenge` 에 실려 온다. 따라서 **`ixauth.login()` 으로는 2단계로 넘어갈 수 없다** — `AUTH_MFA_REQUIRED` 라는 코드만 알고 challenge 는 모르는 상태가 된다. Python 의 `IxAuthError` 도 `code` · `status` 만 들고 있어 같다.

2단계 인증을 쓰는 앱은 **로그인 경로만 직접 부르는 얇은 래퍼**를 둔다. 나머지(토큰 검증·권한 판정)는 SDK 를 그대로 쓴다.

```js
// ixauth-http.js — meta 를 살리는 것 하나만 다르다
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
    err.meta = body?.error?.meta ?? null      // ← challenge 가 여기 있다
    err.traceId = body?.error?.traceId ?? null
    throw err
  }
  return body?.data ?? null
}
```

### 2-2. BFF — 로그인이 challenge 로 갈라지는 자리

```js
import { ixauthFetch } from './ixauth-http.js'

// 로그인 성공 처리를 한 곳에 모은다 — /auth/login 과 /auth/mfa/verify 의 응답이 같은 모양이다
function setSession(req, res, r) {
  res.cookie('ixauth_at', r.accessToken, { httpOnly: true, sameSite: 'lax', secure: true })
  res.cookie('ixauth_rt', r.refreshToken, { httpOnly: true, sameSite: 'lax', secure: true })

  // 등록·재동의 강제는 앱이 한다. 서버는 신호만 준다
  if (r.mfaSetupRequired) return res.json({ step: 'mfa-setup' })
  if (r.termsAgreementRequired?.length) {
    return res.json({ step: 'terms', codes: r.termsAgreementRequired })
  }
  return res.json({ step: 'done' })
}

// ① 1단계 — 비밀번호
app.post('/api/login', async (req, res) => {
  try {
    const r = await ixauthFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: req.body.email, password: req.body.password,
        ip: req.ip, userAgent: req.get('user-agent'),
      }),
    })
    return setSession(req, res, r)
  } catch (e) {
    if (e.code === 'AUTH_MFA_REQUIRED') {
      // challenge 를 브라우저로 내려보내지 않는다. 이건 "비밀번호는 맞았다" 는 증표라
      // 반쪽짜리 자격증명이고, JS 가 읽을 수 있는 곳에 두면 그만큼 새기 쉬워진다
      req.session.mfaChallenge = e.meta.challenge
      return res.json({ step: 'mfa', expiresIn: e.meta.expiresIn })
    }
    if (e.code === 'AUTH_INVALID_CREDENTIALS') return res.status(401).json({ error: 'invalid' })
    if (e.code === 'AUTH_ACCOUNT_LOCKED') return res.status(423).json({ error: 'locked' })
    throw e
  }
})

// ② 2단계 — 인증 앱의 6자리 또는 백업 코드
app.post('/api/login/mfa', async (req, res) => {
  const challenge = req.session.mfaChallenge
  if (!challenge) return res.status(400).json({ error: 'restart' })

  try {
    const r = await ixauthFetch('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({
        challenge, code: req.body.code,
        ip: req.ip, userAgent: req.get('user-agent'),
      }),
    })
    delete req.session.mfaChallenge          // 성공했으면 즉시 버린다
    return setSession(req, res, r)
  } catch (e) {
    // 틀린 코드는 challenge 를 소모하지 않는다 — 같은 화면에서 다시 받으면 된다
    if (e.code === 'AUTH_MFA_INVALID') return res.status(401).json({ error: 'invalid-code' })

    // challenge 가 만료됐다(기본 5분). 이때는 로그인부터 다시다
    if (e.code === 'AUTH_TOKEN_EXPIRED') {
      delete req.session.mfaChallenge
      return res.status(401).json({ error: 'expired' })
    }
    throw e
  }
})
```

**`code` 필드 하나에 6자리와 백업 코드를 모두 받는다.** 필드를 나누면 앱이 "지금 사용자가 무엇을 입력하려는지" 를 미리 알아야 하는데, 사용자는 휴대폰이 없다는 것을 깨달은 그 순간에 비로소 백업 코드를 꺼낸다. 화면도 입력 칸 하나로 두고 아래에 "휴대폰이 없으면 백업 코드를 입력하세요" 안내를 붙이는 편이 낫다.

**`ip` · `userAgent` 를 잊지 않는다.** jar 입장에서 클라이언트는 앱 서버라 최종 사용자 IP 를 알 수 없다. 이 값이 없으면 감사 로그와 새 기기 알림이 전부 앱 서버 하나를 가리키고, 로그인 rate limit 도 IP 단위로 세지 못한다.

### 2-3. 등록 화면

```js
// ① 등록 시작 — 이 응답이 백업 코드 평문을 볼 수 있는 유일한 기회다
app.post('/api/mfa/setup', authenticated, async (req, res) => {
  const d = await ixauthFetch('/auth/mfa/totp/setup', {
    method: 'POST', accessToken: req.cookies.ixauth_at,
  })
  // ⚠ 이 응답을 로그·APM·에러 리포트에 남기지 않는다. otpauthUri 안에 시크릿이 있다
  res.json(d)      // { otpauthUri, backupCodes: [ "4KQ2M-9XTVB", … ] }
})

// ② 확인 — 여기서 비로소 켜진다
app.post('/api/mfa/confirm', authenticated, async (req, res) => {
  try {
    const status = await ixauthFetch('/auth/mfa/totp/confirm', {
      method: 'POST', accessToken: req.cookies.ixauth_at,
      body: JSON.stringify({ code: req.body.code }),
    })
    res.json(status)   // { enabled: true, backupCodesRemaining: 10, … }
  } catch (e) {
    if (e.code === 'AUTH_MFA_INVALID') return res.status(400).json({ error: 'invalid-code' })
    throw e
  }
})

app.get('/api/mfa/status', authenticated, async (req, res) =>
  res.json(await ixauthFetch('/auth/mfa/status', { accessToken: req.cookies.ixauth_at })))
```

화면 쪽은 QR · 백업 코드 · 코드 입력을 **한 흐름으로 이어 둔다.**

```tsx
const [setup, setSetup] = useState<{ otpauthUri: string; backupCodes: string[] } | null>(null)
const [qr, setQr] = useState('')
const [saved, setSaved] = useState(false)

async function start() {
  const d = await fetch('/api/mfa/setup', { method: 'POST' }).then(r => r.json())
  setSetup(d)
  setQr(await QRCode.toDataURL(d.otpauthUri))    // qrcode 패키지 — 앱이 고른다
}

// …
<img src={qr} alt="인증 앱으로 스캔" />
<details>
  <summary>QR 을 스캔할 수 없나요?</summary>
  {/* 데스크톱 인증 앱을 위해 시크릿 문자열도 그대로 보여 준다 */}
  <code>{new URL(setup.otpauthUri).searchParams.get('secret')}</code>
</details>

<h3>백업 코드 — 지금 저장하세요</h3>
<p>휴대폰을 잃어버렸을 때 들어올 수 있는 <b>유일한 수단</b>입니다.
   이 화면을 벗어나면 <b>다시 볼 수 없습니다.</b></p>
<pre>{setup.backupCodes.join('\n')}</pre>
<button onClick={() => download(setup.backupCodes)}>텍스트 파일로 저장</button>
<label><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
  백업 코드를 안전한 곳에 저장했습니다</label>

{/* 저장 확인 전에는 코드 입력으로 넘어가지 않는다 */}
<input disabled={!saved} value={code} onChange={…} placeholder="인증 앱의 6자리 코드" />
```

### 2-4. 해제 화면

```js
// ⚠ 본문이 있는 DELETE 다
app.delete('/api/mfa', authenticated, async (req, res) => {
  try {
    await ixauthFetch('/auth/mfa/totp', {
      method: 'DELETE', accessToken: req.cookies.ixauth_at,
      body: JSON.stringify({
        currentPassword: req.body.currentPassword,
        mfaCode: req.body.mfaCode,      // step-up-actions 에 MFA_DISABLE 이 있을 때만 필요
      }),
    })
    res.json({ ok: true })
  } catch (e) {
    if (e.code === 'AUTH_INVALID_CREDENTIALS') return res.status(401).json({ error: 'password' })
    // mode 가 REQUIRED_* 인 계정은 스스로 끌 수 없다
    if (e.code === 'AUTHZ_FORBIDDEN') return res.status(403).json({ error: 'required-by-policy' })
    // step-up 이 켜져 있는데 코드를 안 보냈다 — 같은 화면에서 코드를 받아 다시 보낸다
    if (e.code === 'AUTH_MFA_REQUIRED') return res.status(401).json({ error: 'need-code' })
    throw e
  }
})
```

**해제에 현재 비밀번호를 요구하는 이유** — 확인하지 않으면 자리를 비운 사이 남이 2단계를 꺼 버릴 수 있고, 그러면 이 기능이 있는 이유가 사라진다. 소셜 로그인만 쓰는 계정(비밀번호 없음)은 이 경로로 해제할 수 없으므로 관리자를 거쳐야 한다.

`ixauth.mfa.step-up-actions` 에 `MFA_DISABLE` 을 넣으면 **코드까지 요구한다.** 2단계를 끄는 데 2단계 코드를 받는 것이 이상해 보이지만, 이것이 없으면 비밀번호를 훔친 쪽이 2단계부터 꺼 버리고 나머지 보호를 전부 무력화한다. 이때 오는 `AUTH_MFA_REQUIRED` 는 **`meta.challenge` 가 없고 `meta.stepUp` 이 있다** — 로그인 화면으로 보내는 것이 아니라 그 화면에서 코드를 받아 **같은 요청을 다시** 보내면 된다.

### 2-5. Python / FastAPI

SDK 에 함수가 없는 것은 여기도 같다. `httpx` 로 직접 부른다.

```python
import httpx

BASE = os.environ["IXAUTH_BASE_URL"]
HEADERS = {"X-IxAuth-Key": os.environ["IXAUTH_SERVICE_KEY"]}

def ixauth_call(method: str, path: str, *, access_token: str | None = None, **kw):
    headers = dict(HEADERS)
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    with httpx.Client(timeout=10.0) as c:
        res = c.request(method, f"{BASE}{path}", headers=headers, **kw)
    body = res.json() if res.content else {}
    if res.status_code >= 400:
        err = body.get("error") or {}
        # meta 를 살려서 돌려준다 — SDK 의 IxAuthError 는 이걸 버린다
        raise IxAuthApiError(err.get("code"), err.get("message"), res.status_code,
                             err.get("meta") or {})
    return body.get("data")


@app.post("/api/login")
async def login(req: Request, body: LoginBody):
    try:
        r = ixauth_call("POST", "/auth/login", json={
            "email": body.email, "password": body.password,
            "ip": req.client.host, "userAgent": req.headers.get("user-agent"),
        })
    except IxAuthApiError as e:
        if e.code == "AUTH_MFA_REQUIRED":
            req.session["mfa_challenge"] = e.meta["challenge"]
            return {"step": "mfa", "expiresIn": e.meta["expiresIn"]}
        raise
    return set_session(r)


@app.post("/api/login/mfa")
async def login_mfa(req: Request, body: MfaBody):
    challenge = req.session.get("mfa_challenge")
    if not challenge:
        raise HTTPException(400, "restart")
    r = ixauth_call("POST", "/auth/mfa/verify", json={
        "challenge": challenge, "code": body.code,
        "ip": req.client.host, "userAgent": req.headers.get("user-agent"),
    })
    req.session.pop("mfa_challenge", None)
    return set_session(r)
```

---

## 3. 백업 코드 — 한 번만 보여 준다

등록 응답의 `backupCodes` 는 **평문이고, 그 응답에서만 볼 수 있다.** DB 에는 SHA-256 해시만 남기므로 서버조차 원래 값을 모른다. 다시 보여 주는 API 는 없고, 앞으로도 만들지 않는다 — 다시 볼 수 있으면 access token 을 훔친 쪽도 그것을 볼 수 있고, 그 순간 백업 코드는 "휴대폰을 가진 사람만 아는 값" 이 아니게 된다.

```
4KQ2M-9XTVB      ← 5글자 + 5글자. I·O·0·1 은 쓰지 않는다 (눈으로 옮겨 적는 값이라)
```

- 기본 **10개**(`mfa.backup-code-count`). 하나 쓰면 그 코드는 사라진다
- 입력할 때 **하이픈·공백·대소문자를 무시**한다. 종이에 적어 둔 것을 보고 치는 값이라 그렇다
- `GET /auth/mfa/status` 의 `backupCodesRemaining` 으로 남은 개수를 알 수 있다
- **재발급 API 는 없다.** 다 썼으면 2단계를 해제하고 다시 등록하는 것이 경로다

그래서 등록 화면이 **"지금 저장하세요" 를 강하게 안내해야 한다.** 사용자는 그 순간 인증 앱이 눈앞에 있으니 백업 코드가 왜 필요한지 실감하지 못하고, 정작 필요해지는 것은 휴대폰을 잃어버린 몇 달 뒤다. 그때는 이 화면을 다시 열 방법이 없다.

- 저장 확인 체크박스를 **코드 입력 칸의 활성화 조건**으로 건다 (위 2-3 예시)
- 파일 다운로드·인쇄·클립보드 복사 중 최소 하나는 붙인다
- 백업 코드를 **화면 캡처로 남기라고 안내하지 않는다** — 사진첩은 대개 클라우드에 자동 동기화되고, 그러면 2단계 인증의 전제가 무너진다

---

## 4. 자주 겪는 문제

### 4-1. 코드가 계속 안 맞는다 — 대개 서버 시계다

TOTP 는 **시각을 입력으로 쓰는 알고리즘**이라 IX-Auth 서버와 사용자 휴대폰의 시계가 같아야 한다. 허용 오차는 **앞뒤 1스텝(±30초)** 뿐이고, 이 값은 설정에 없다.

```bash
# 서버 시계 확인 — 폐쇄망이면 NTP 가 막혀 조용히 틀어져 있는 경우가 많다
ssh <ix-auth 서버> "timedatectl status"
# System clock synchronized: yes  ← 이 줄이 no 면 원인이 여기다
```

컨테이너로 띄웠다면 호스트 시계를 본다. 사용자 쪽이 원인일 때는 인증 앱의 "시간 보정"(Google Authenticator 의 *Time correction for codes*) 을 안내한다.

### 4-2. 방금 뜬 코드인데 거부된다 — 재사용 차단이다

**같은 스텝(30초 구간)의 코드는 두 번 통하지 않는다.** 마지막으로 성공한 스텝을 저장해 두고 그보다 크지 않은 코드는 거부한다. 로그인에 성공한 직후 곧바로 민감 작업에서 코드를 또 요구받으면, 화면에 떠 있는 그 코드는 이미 쓴 코드라 통하지 않는다 — **다음 코드로 바뀔 때까지 기다려야 한다.**

응답은 `AUTH_MFA_INVALID`(401) 하나로 **틀린 코드와 재사용을 구분하지 않는다.** 구분해 주면 "그 코드는 맞았다" 는 사실이 새어나가기 때문이다. 앱 화면에는 "코드가 올바르지 않습니다. 다음 코드가 나올 때까지 기다렸다가 다시 시도하세요" 정도로 두 경우를 함께 안내하는 편이 낫다.

### 4-3. 백업 코드를 다 썼다

`backupCodesRemaining` 이 0 이 되면 남는 수단은 인증 앱뿐이다. 재발급 API 가 없으므로 **해제 → 재등록**이 정상 경로이고, 그러려면 인증 앱이 살아 있어야 한다.

운영에서는 여기까지 가기 전에 알아채는 것이 목적이다. 계정 설정 화면에 남은 개수를 항상 보여 주고, **2개 이하로 떨어지면 경고**를 띄운다. 서버 로그에도 마지막 하나를 쓴 시점에 `백업 코드를 모두 썼다 — user=… 재등록이 필요하다` 가 WARN 으로 남는다.

### 4-4. 휴대폰과 백업 코드를 모두 잃었다 — 관리자 초기화

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://ix-auth/admin/users/41/mfa-reset
# {"data":{"reset":true}}      false = 등록돼 있던 것이 없었다
```

필요 권한은 `ixauth:users:write` 다. `ixauth.mfa.admin-reset` 이 `false` 면 `AUTHZ_FORBIDDEN`(403).

**두 가지가 반드시 따라붙고, 설정으로 끌 수 없다.**

| | 왜 |
|---|-----|
| 감사 로그 `MFA_RESET_BY_ADMIN` | 누가 · 누구를 · 언제. 없으면 사고 조사에서 되짚을 수 없다 |
| 대상자에게 나가는 통지 메일 | 본인이 요청하지 않은 초기화는 이 메일로만 드러난다 |

등록된 것이 없어도(`reset: false`) 기록과 통지는 나간다 — "시도했다" 는 사실 자체가 신호다. 관리자가 **조용히** 남의 2단계를 끄고 그 계정으로 들어가는 일이 없어야 한다.

이 기능을 끄면(`admin-reset: false`) 남는 복구 수단이 **DB 직접 수정**뿐이라는 점을 기억한다. 그쪽은 감사 로그도 통지도 남지 않아 오히려 위험하고, 애초에 `ixauth:users:write` 를 가진 사람은 이미 그 계정의 비밀번호를 초기화할 수 있다.

### 4-5. `mode` 가 `REQUIRED_*` 인데 사용자가 해제를 눌렀다

`AUTHZ_FORBIDDEN`(403) — *"이 계정은 2단계 인증을 해제할 수 없습니다. 관리자에게 문의하세요."*

필수인 사람이 스스로 끌 수 있으면 그 설정은 권고문에 지나지 않으므로, **비밀번호가 맞아도 거부한다.** `REQUIRED_ADMIN` 은 `ixauth:*` 권한 보유자만 해당하므로, 같은 화면에서 어떤 사용자는 되고 어떤 사용자는 안 된다. 앱은 `GET /auth/mfa/status` 의 `mode` 와 `setupRequired` 를 보고 **해제 버튼 자체를 감추는** 편이 낫다.

### 4-6. 소셜 로그인은 2단계를 요구하지 않는다

카카오·Microsoft·네이버·Google 로 들어온 로그인은 `AUTH_MFA_REQUIRED` 를 내지 않는다. provider 가 이미 본인확인(대개 자체 2단계를 포함한다)을 마친 경로이고, 여기서 막으면 소셜로만 쓰던 사용자가 들어올 방법이 없어지기 때문이다.

**다만 `mfaSetupRequired` 신호는 소셜 로그인 응답에도 실린다.** 토큰이 나가는 모든 경로가 같은 코드를 지나기 때문이다. 즉 "코드를 입력받는 일" 은 없지만 "등록 화면으로 보내라" 는 신호는 온다 — 앱의 소셜 콜백 처리도 `mfaSetupRequired` 를 봐야 한다.

**매직 링크는 반대다.** `POST /auth/magic-link/verify` 는 2단계를 **요구한다** — 그 경로에서 본인을 확인한 것은 메일함 접근 하나뿐이라, 요구하지 않으면 우리 2단계가 메일 한 통으로 무력화된다. 응답 형태는 로그인과 완전히 같으므로 위 2-2 의 분기를 그대로 재사용하면 된다.

### 4-7. `DELETE /auth/mfa/totp` 에 본문이 안 들어간다

해제는 **본문이 있는 DELETE** 다(`currentPassword`). 일부 HTTP 클라이언트·프록시는 DELETE 의 본문을 조용히 버리므로, `currentPassword` 가 비어 도착해 `AUTH_INVALID_CREDENTIALS` 로 보인다. Node 의 `fetch` · Python 의 `httpx` 는 정상 전송한다 — 그 사이에 있는 프록시를 먼저 의심한다.

### 4-8. `setup` 을 두 번 불렀다

이미 **켜져 있는**(confirm 까지 끝난) 상태에서 `setup` 을 다시 부르면 `CONFLICT`(409) 다. 조용히 갈아 끼우면 토큰을 훔친 쪽이 자기 인증 앱으로 바꿔 놓고 주인을 밀어낼 수 있다.

반면 **확인 전(`pendingConfirm: true`) 상태에서 다시 부르면 새 시크릿과 새 백업 코드가 발급되고 앞의 것은 버려진다.** 사용자가 등록 화면을 새로고침한 경우가 이에 해당하는데, **인증 앱에는 앞서 스캔한 항목이 남아 있으므로** 그 항목의 코드는 이제 통하지 않는다. 등록 화면을 이탈했다가 돌아온 사용자에게 "인증 앱에 이전에 추가한 항목이 있다면 지우고 새로 스캔하세요" 를 안내한다.

### 4-9. 그 밖의 응답 코드

| 코드 | HTTP | 언제 | 앱이 할 일 |
|------|------|------|-----------|
| `AUTH_MFA_REQUIRED` | 401 | 로그인 2단계 필요 (`meta.challenge` 있음) | challenge 보관 → 코드 화면 |
| `AUTH_MFA_REQUIRED` | 401 | step-up 재인증 (`meta.stepUp` 있음, challenge 없음) | 그 화면에서 코드 받아 **같은 요청 재전송** |
| `AUTH_MFA_INVALID` | 401 | 코드 불일치 · 재사용 · 이미 쓴 백업 코드 | **같은 challenge 로 재시도 가능** |
| `AUTH_TOKEN_EXPIRED` | 401 | challenge 만료(기본 5분) | **로그인부터 다시** |
| `AUTH_TOKEN_INVALID` | 401 | challenge 위조·다른 용도의 토큰·그 사이 2단계가 해제됨 | 로그인부터 다시 |
| `CONFLICT` | 409 | 이미 켜져 있는데 `setup` · 등록 없이 `confirm` | 현재 상태를 다시 조회해 화면을 맞춘다 |
| `AUTHZ_FORBIDDEN` | 403 | `REQUIRED_*` 계정의 해제 시도 · `admin-reset: false` | 안내만. 버튼을 감추는 편이 낫다 |

**2단계 코드 실패는 계정 잠금 카운터에 올라간다.** 그리고 `/auth/mfa/verify` 는 `/auth/login` 과 **같은 rate limit 버킷**(IP 당 분당 10회)을 쓴다. 앱이 자동 재시도를 걸어 두면 사용자를 스스로 잠근다.

---

## 5. 운영 점검 목록

| | 확인 |
|---|------|
| ☐ | `IXAUTH_MFA_ENCRYPTION_KEY` 를 **service-key 와 별도로** 주었는가 (안 그러면 키 교체 시 전원 재등록) |
| ☐ | IX-Auth 서버의 시계가 NTP 로 동기화돼 있는가 (`timedatectl status`) |
| ☐ | 앱이 `mfaSetupRequired` 를 보고 등록 화면으로 보내는가 — 안 보면 `REQUIRED_ALL` 이 무효다 |
| ☐ | **소셜 로그인 콜백 처리에도** `mfaSetupRequired` 분기가 있는가 |
| ☐ | 등록 화면이 백업 코드 저장을 **확인받고** 다음으로 넘어가는가 |
| ☐ | 남은 백업 코드 수를 사용자에게 보여 주고 소진 전에 경고하는가 |
| ☐ | `otpauthUri` · `backupCodes` 가 로그·APM·에러 리포트에 들어가지 않는가 |
| ☐ | challenge 를 브라우저(로컬스토리지·쿠키)가 아니라 **서버 세션**에 두는가 |
| ☐ | `AUTH_MFA_INVALID` 에서 같은 challenge 로 재시도하게 돼 있는가 (로그인부터 다시 시키지 않는다) |
| ☐ | 관리자 계정이 **둘 이상**이거나, 관리자의 백업 코드가 별도로 보관돼 있는가 |
| ☐ | `admin-reset` 을 껐다면 복구 경로를 대신할 절차가 문서화돼 있는가 |
| ☐ | `step-up-actions` 를 켜기 **전에** 앱의 해당 화면들이 `mfaCode` 를 보내도록 고쳤는가 |

---

## 관련 문서

- 계약: [`docs/contract/http-api.md`](../contract/http-api.md) §2-3 (2단계 인증) · §2-6 (step-up 재인증) · §4 (관리자 초기화)
- 설정: [`docs/contract/config.md`](../contract/config.md) §5-4
- 에러 코드: [`docs/contract/errors.md`](../contract/errors.md)
- 함께 보는 신호: [`약관 동의 가이드`](terms.md) — `termsAgreementRequired` 도 같은 방식으로 동작한다
