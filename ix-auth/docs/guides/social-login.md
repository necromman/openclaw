# 소셜 로그인 붙이기 — Microsoft · 카카오 · 네이버 · Google

이 문서 하나로 끝낼 수 있게 썼다. provider 콘솔 등록 → IX-Auth 설정 → 앱 코드 순이다.

> provider 콘솔의 메뉴 이름은 종종 바뀐다. 화면 문구가 다르면 **여기 적힌 "무엇을 얻어야 하는지"** 를 기준으로 찾으면 된다.

---

## 0. 먼저 이해할 것 — 콜백은 앱이 받는다

가장 많이 헷갈리는 지점이다.

```
① 앱  → IX-Auth   GET /auth/social/kakao/authorize-url?redirectUri=https://myapp.com/oauth/kakao
② 앱  → 브라우저   받은 url 로 리다이렉트
③ 사용자 → 카카오   동의
④ 카카오 → 앱      https://myapp.com/oauth/kakao?code=…&state=…     ← 여기가 앱이다
⑤ 앱  → IX-Auth   POST /auth/social/kakao/callback { code, state }
⑥ IX-Auth         토큰 교환 · 프로필 조회 · 계정 매칭 · 세션 발급
⑦ 앱              받은 토큰을 HttpOnly 쿠키로 심는다
```

**④의 주소가 앱 도메인인 이유**: IX-Auth 는 외부에 노출되지 않는다(설계 불변식 4). 인터넷에 열려 있지 않으니 카카오가 브라우저를 그쪽으로 돌려보낼 수 없다. 이건 설계 취향이 아니라 불변식의 결과다.

그래서 **provider 콘솔에 등록할 Redirect URI 는 전부 앱 주소다.** IX-Auth 주소를 적으면 동작하지 않는다.

---

## 1. provider 콘솔 등록

각 콘솔에서 얻어야 하는 것은 셋뿐이다 — **클라이언트 ID**, **시크릿**, 그리고 **Redirect URI 등록**.

### 1-1. Microsoft (Entra ID)

[Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **앱 등록** → **새 등록**

| 항목 | 값 |
|------|-----|
| 이름 | 아무거나 (예: `MyApp Login`) |
| 지원되는 계정 유형 | **사내용이면 "이 조직 디렉터리의 계정만"** |
| 리디렉션 URI | 웹 — `https://myapp.com/oauth/microsoft` |

등록 후:

1. **개요** 에서 `애플리케이션(클라이언트) ID` 와 `디렉터리(테넌트) ID` 를 복사
2. **인증서 및 암호** → **새 클라이언트 암호** → 생성된 **값**(ID 아님)을 복사. 이 값은 그때 한 번만 보인다
3. **API 권한** 에 `User.Read` 가 있는지 확인 (기본으로 들어 있다)

⚠️ **테넌트 선택이 보안에 직결된다.**

| `tenant` 설정 | 누가 로그인할 수 있나 | 이메일 자동 연결 |
|--------------|---------------------|----------------|
| 테넌트 ID (예: `72f988bf-…`) | **그 조직 구성원만** | 가능 |
| `organizations` | 아무 조직 계정이나 | 불가 |
| `common` | 아무 Microsoft 계정이나 (개인 포함) | 불가 |

사내 시스템에 `common` 을 쓰면 **누구나 동의 화면을 통과한다.** 테넌트 ID 를 넣어야 한다. IX-Auth 는 테넌트가 고정된 경우에만 그 이메일을 "검증됨" 으로 취급한다(→ [4절](#4-계정-매칭--누구를-어디까지-믿는가)).

### 1-2. 카카오

[Kakao Developers](https://developers.kakao.com) → **내 애플리케이션** → **애플리케이션 추가하기**

1. **앱 키** → `REST API 키` 를 복사 → 이게 `client-id` 다 (JavaScript 키가 아니다)
2. **카카오 로그인** → 활성화 **ON**
3. **카카오 로그인 → Redirect URI** 에 `https://myapp.com/oauth/kakao` 등록
4. **카카오 로그인 → 동의항목** 에서
   - `닉네임` — 필수 동의 또는 선택 동의
   - **`카카오계정(이메일)`** — 여기가 중요하다
5. **보안 → Client Secret** 을 생성하고 **사용함** 으로 설정 (선택이지만 권장)

⚠️ **이메일은 선택 동의다.** 사용자가 동의하지 않으면 주소가 오지 않는다. 그러면 IX-Auth 는 자동 가입을 할 수 없다 — 이메일 없는 계정은 비밀번호 찾기도 알림도 불가능하기 때문이다. 이메일을 필수로 받으려면 **비즈 앱 전환**이 필요하다.

카카오는 검증 여부(`is_email_verified`)를 명시적으로 주므로, 그 신호는 믿을 수 있다.

### 1-3. 네이버

[네이버 개발자센터](https://developers.naver.com) → **Application** → **애플리케이션 등록**

| 항목 | 값 |
|------|-----|
| 사용 API | **네이버 로그인** |
| 제공 정보 | 이메일 주소·이름 등 필요한 것 |
| 서비스 URL | `https://myapp.com` |
| Callback URL | `https://myapp.com/oauth/naver` |

등록 후 **애플리케이션 정보** 에서 `Client ID` 와 `Client Secret` 을 복사한다.

⚠️ **네이버는 이메일 검증 여부를 주지 않는다.** 그래서 IX-Auth 는 네이버로 들어온 사용자를 **같은 이메일의 기존 계정에 자동으로 붙이지 않는다.** 네이버가 주소를 확인하지 않는다는 뜻이 아니라, 확인했다는 신호를 API 로 주지 않는다는 뜻이다 — 모르는 것을 안다고 가정하지 않는 쪽을 택했다.

네이버 사용자를 기존 계정에 연결하려면 [5-4절](#5-4-내-계정에-연결하기-가장-안전한-경로)의 수동 연결을 쓴다.

### 1-4. Google

> 2026-08-08 추가.

[Google Cloud Console](https://console.cloud.google.com) → 프로젝트 선택(또는 새로 만들기)

**① OAuth 동의 화면** (`API 및 서비스` → `OAuth 동의 화면`)

| 항목 | 값 |
|------|-----|
| User Type | **내부** — 조직 계정만 (Workspace 가 있을 때) / **외부** — 아무 Google 계정 |
| 앱 이름 · 지원 이메일 | 사용자가 동의 화면에서 보는 것이라 실제 서비스 이름을 적는다 |
| 승인된 도메인 | 앱 도메인 (예: `example.com`) |
| 범위(scope) | `openid` · `email` · `profile` 셋이면 된다. 그 이상은 심사 대상이 된다 |

⚠ **User Type 이 보안에 직결된다.** `외부` 는 Microsoft 의 `common` 과 같다 — Google 계정을 가진 **누구나** 동의 화면을 통과한다. Workspace 조직이 있다면 `내부` 를 고르는 것이 사내 시스템에 맞다.

⚠ `외부` + `테스트` 상태로 두면 **테스트 사용자로 등록한 계정만** 로그인된다. 운영 전에 `게시` 로 바꿔야 하고, 안 그러면 "나는 되는데 남들은 안 된다" 가 된다.

**② 사용자 인증 정보** (`API 및 서비스` → `사용자 인증 정보` → `사용자 인증 정보 만들기` → `OAuth 클라이언트 ID`)

| 항목 | 값 |
|------|-----|
| 애플리케이션 유형 | **웹 애플리케이션** |
| 승인된 리디렉션 URI | `https://myapp.com/oauth/google` ← **앱 주소다** |

만들면 `클라이언트 ID`(`…apps.googleusercontent.com`)와 `클라이언트 보안 비밀번호`가 나온다. 보안 비밀번호는 그 자리에서 복사한다.

**API 를 따로 켤 필요는 없다.** `oauth2/v3/userinfo` 는 OIDC 표준 엔드포인트라 별도 활성화가 없다 (People API 를 켜라는 안내를 보게 되는데, 그건 연락처·프로필 상세를 쓸 때 얘기다).

✅ **Google 은 이메일 검증 여부를 규격으로 준다** (`email_verified`, OIDC 표준 클레임). 넷 중 가장 믿을 수 있는 신호라 같은 이메일의 기존 계정에 자동 연결된다.

⚠ 다만 **범위를 좁히는 수단이 Microsoft 의 테넌트만큼 강하지 않다.** `내부` 를 쓸 수 없는 상황이라면 `auto-signup: false` 로 두고 초대받은 계정에만 붙게 하거나 `account.signup-allowed-domains` 로 도메인을 건다. `hd` 파라미터는 힌트일 뿐 강제가 아니므로 그것에 기대지 않는다.

---

## 2. IX-Auth 설정

```yaml
ixauth:
  social:
    enabled: true

    # 처음 보는 소셜 계정을 자동으로 만들지.
    # 켜면 그 provider 계정을 가진 누구나 들어온다 — 사내용이면 끄고 초대를 쓴다
    auto-signup: false

    # 같은 이메일의 기존 계정에 자동 연결할지.
    # provider 가 "검증했다" 고 명시한 경우에만 적용된다 (4절)
    auto-link-verified-email: true

    microsoft:
      enabled: true
      client-id: ${MS_CLIENT_ID}
      client-secret: ${MS_CLIENT_SECRET}
      tenant: 72f988bf-...          # 사내용이면 반드시 테넌트 ID
    kakao:
      enabled: true
      client-id: ${KAKAO_REST_API_KEY}
      client-secret: ${KAKAO_CLIENT_SECRET}
    naver:
      enabled: true
      client-id: ${NAVER_CLIENT_ID}
      client-secret: ${NAVER_CLIENT_SECRET}
    google:
      enabled: true
      client-id: ${GOOGLE_CLIENT_ID}          # …apps.googleusercontent.com
      client-secret: ${GOOGLE_CLIENT_SECRET}
```

환경변수로도 된다.

```bash
IXAUTH_SOCIAL_ENABLED=true
IXAUTH_SOCIAL_KAKAO_ENABLED=true
IXAUTH_SOCIAL_KAKAO_CLIENT_ID=...
IXAUTH_SOCIAL_KAKAO_CLIENT_SECRET=...
```

`client-id` 가 비어 있으면 켜도 목록에 나오지 않는다. **눌렀을 때 provider 화면에서 실패하는 것보다 버튼이 아예 없는 편이 낫다**는 판단이다.

설정이 제대로 걸렸는지는 관리 콘솔 **시스템** 탭에서 확인하거나, 이렇게 본다.

```bash
curl -H "X-IxAuth-Key: $KEY" http://ix-auth:9100/auth/social/providers
# {"data":{"enabled":true,"providers":["MICROSOFT","KAKAO","NAVER","GOOGLE"]}}
```

---

## 3. 앱 구현

### 3-1. BFF (Node / Express)

```js
import { createIxAuthClient } from '@ix-auth/client-node'

const ixauth = createIxAuthClient()
const CALLBACK = (p) => `${process.env.APP_BASE_URL}/oauth/${p}`

// 로그인 화면이 어떤 버튼을 그릴지 정하는 데 쓴다
app.get('/api/social/providers', async (_req, res) => {
  res.json(await ixauth.socialProviders())
})

// ① 사용자를 provider 로 보낸다
app.get('/api/social/:provider/start', async (req, res) => {
  const { url } = await ixauth.socialAuthorizeUrl(req.params.provider,
    CALLBACK(req.params.provider))
  res.redirect(url)
})

// ④⑤ provider 가 여기로 돌려보낸다 → IX-Auth 로 중계
app.get('/oauth/:provider', async (req, res) => {
  const { code, state, error } = req.query
  if (error || !code) return res.redirect('/login?error=social')

  try {
    const r = await ixauth.socialCallback(req.params.provider, code, state)

    // ⑦ 토큰은 반드시 HttpOnly 쿠키로. 브라우저 JS 에 넘기지 않는다
    res.cookie('ixauth_at', r.accessToken, { httpOnly: true, sameSite: 'lax', secure: true })
    res.cookie('ixauth_rt', r.refreshToken, { httpOnly: true, sameSite: 'lax', secure: true })
    res.redirect('/')
  } catch (e) {
    // 실패 사유를 화면에 그대로 노출하지 않는다
    if (e.code === 'AUTH_SOCIAL_NO_ACCOUNT') return res.redirect('/login?error=no-account')
    res.redirect('/login?error=social')
  }
})
```

**`redirectUri` 는 ①과 provider 콘솔 등록값이 정확히 같아야 한다.** 토큰 교환 때도 같은 값이 쓰이는데, 그건 IX-Auth 가 ①에서 저장해 두므로 앱이 다시 보낼 필요는 없다.

### 3-2. 로그인 화면 (React)

```tsx
const [providers, setProviders] = useState<string[]>([])

useEffect(() => {
  fetch('/api/social/providers').then(r => r.json())
    .then(d => setProviders(d.providers ?? []))
}, [])

const LABEL: Record<string, string> = {
  MICROSOFT: 'Microsoft 로 로그인',
  KAKAO: '카카오로 로그인',
  NAVER: '네이버로 로그인',
  GOOGLE: 'Google 로 로그인',
}

return providers.map(p => (
  // 링크로 둔다 — fetch 로 부르면 리다이렉트가 CORS 에 막힌다
  <a key={p} href={`/api/social/${p.toLowerCase()}/start`} className="social-btn">
    {LABEL[p] ?? p}
  </a>
))
```

**버튼을 하드코딩하지 않는다.** `providers` 를 물어서 그린다 — 그래야 설정에서 끈 provider 의 버튼이 남아 "눌렀는데 안 되는" 상태가 생기지 않는다.

### 3-3. Python / FastAPI

```python
from fastapi import Request
from fastapi.responses import RedirectResponse
from ix_auth_client import IxAuthClient

ixauth = IxAuthClient()
CALLBACK = lambda p: f"{APP_BASE_URL}/oauth/{p}"

@app.get("/api/social/{provider}/start")
async def start(provider: str):
    data = ixauth.social_authorize_url(provider, CALLBACK(provider))
    return RedirectResponse(data["url"])

@app.get("/oauth/{provider}")
async def callback(provider: str, request: Request):
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    if not code:
        return RedirectResponse("/login?error=social")

    r = ixauth.social_callback(provider, code, state)
    res = RedirectResponse("/")
    res.set_cookie("ixauth_at", r["accessToken"], httponly=True, samesite="lax", secure=True)
    res.set_cookie("ixauth_rt", r["refreshToken"], httponly=True, samesite="lax", secure=True)
    return res
```

---

## 4. 계정 매칭 — 누구를 어디까지 믿는가

소셜 로그인에서 사고가 나는 지점은 대부분 여기다.

판정 순서:

| 순서 | 조건 | 결과 |
|------|------|------|
| ① | `(provider, subject)` 로 **이미 연결됨** | 그 사용자로 로그인 |
| ② | 같은 이메일의 계정이 있고 **provider 가 검증했다고 명시** | 자동 연결 |
| ③ | 처음 보는 사용자 | `auto-signup` 이 켜져 있고 이메일이 있을 때만 생성 |
| ④ | 그 외 | `AUTH_SOCIAL_NO_ACCOUNT` (403) |

**매칭 기준이 이메일이 아니라 `subject` 인 이유** — 이메일은 바뀌고, 회사 도메인 주소는 퇴사자가 나간 뒤 **다른 사람에게 재할당**되기도 한다. subject 로 묶어야 그런 변화에도 같은 사람이다. 사용자가 provider 쪽에서 이메일을 바꿔도 IX-Auth 계정은 그대로 이어진다.

**②가 위험한 이유** — provider 가 "이 주소를 검증했다" 고 하지 않았는데 이메일만 보고 붙이면, 남의 주소를 자기 소셜 계정 프로필에 적어 넣는 것만으로 그 계정을 가져갈 수 있다. 그래서 IX-Auth 는 검증 신호가 있을 때만 붙인다.

| provider | 검증 신호 | ②가 되는가 |
|----------|----------|-----------|
| **Google** | `email_verified` — **OIDC 표준 클레임** | ✅ |
| 카카오 | `is_email_verified` + `is_email_valid` | ✅ |
| Microsoft | 신호 없음. **테넌트 ID 로 고정한 경우에만** 조직이 발급한 주소로 신뢰 | 테넌트 고정 시 ✅ |
| 네이버 | **없음** | ❌ |

`auto-link-verified-email: true` 여도 네이버는 붙지 않는다. 설정보다 provider 의 신호가 우선이다.

**Google 은 신호와 범위를 따로 봐야 한다.** 신호(`email_verified`)는 믿을 수 있어서 ②가 되지만, 그것이 "우리 조직 사람이다" 를 뜻하지는 않는다. 동의 화면 User Type 이 `외부` 면 Google 계정을 가진 누구나 ③(자동 가입)까지 갈 수 있으므로, 사내 시스템이라면 `auto-signup` 을 끄거나 도메인 제한을 함께 건다.

### 사내 시스템 권장 조합

```yaml
auto-signup: false                 # 초대받은 사람만
auto-link-verified-email: true
microsoft:
  tenant: <조직 테넌트 ID>          # common 금지
```

이러면 흐름이 이렇게 된다 — 관리자가 이메일로 초대 → 사용자가 Microsoft 로 로그인 → 조직 계정이므로 검증된 주소 → 초대받은 계정에 자동 연결. 사용자는 비밀번호를 만들 필요가 없다.

---

## 5. 자주 겪는 문제

### 5-1. `redirect_uri_mismatch` (또는 카카오 KOE006)

provider 콘솔에 등록한 값과 앱이 보낸 값이 **한 글자라도** 다르면 난다. 흔한 원인:

- `http` vs `https`
- 끝의 `/` 유무 — `https://myapp.com/oauth/kakao` 와 `.../kakao/` 는 다른 값이다
- 포트 — 개발 중 `localhost:3000` 과 `localhost:5173`
- 개발·운영 주소를 **둘 다** 등록하지 않음

### 5-2. 카카오인데 이메일이 안 온다

동의항목에서 `카카오계정(이메일)` 을 켰는지, 그리고 사용자가 **실제로 동의했는지** 확인한다. 선택 동의라 거부할 수 있다.

이미 동의를 거부한 사용자는 다시 물어보지 않는다 — 카카오 계정 설정에서 연결을 끊거나, 앱에서 재동의를 요청해야 한다.

이메일이 없으면 `auto-signup` 이 켜져 있어도 계정이 만들어지지 않는다. 이메일 없는 계정은 비밀번호 찾기도, 알림도 보낼 수 없기 때문이다.

### 5-3. `AUTH_SOCIAL_NO_ACCOUNT` (403)

"연결된 계정이 없습니다." 원인은 셋 중 하나다.

1. `auto-signup: false` 인데 처음 보는 사용자다 → **정상 동작이다.** 초대를 먼저 보낸다
2. 같은 이메일의 계정은 있는데 ②의 검증 조건에 걸렸다 (네이버, 또는 `common` 테넌트 MS)
3. provider 가 이메일을 주지 않았다 (카카오 미동의)

응답은 셋을 구분하지 않는다 — 구분해 주면 "그 이메일로 가입된 계정이 있다" 는 사실이 새어 나간다. **서버 로그에는 원인이 남으므로** 운영자는 거기서 확인한다.

### 5-4. 내 계정에 연결하기 (가장 안전한 경로)

네이버처럼 자동 연결이 안 되는 경우, 또는 사용자가 여러 provider 를 붙이고 싶은 경우.

```js
// 로그인한 상태에서 시작한다
app.get('/api/social/:provider/link/start', authenticated, async (req, res) => {
  const { url } = await ixauth.socialAuthorizeUrl(req.params.provider,
    `${APP_BASE_URL}/oauth/${req.params.provider}/link`)
  res.redirect(url)
})

app.get('/oauth/:provider/link', authenticated, async (req, res) => {
  await ixauth.socialLink(req.cookies.ixauth_at, req.params.provider,
    req.query.code, req.query.state)
  res.redirect('/settings/accounts')
})

// 연결 목록 / 해제
app.get('/api/social/links', authenticated, async (req, res) =>
  res.json(await ixauth.socialLinks(req.cookies.ixauth_at)))

app.delete('/api/social/:provider/link', authenticated, async (req, res) => {
  await ixauth.socialUnlink(req.cookies.ixauth_at, req.params.provider)
  res.json({ ok: true })
})
```

본인 확인이 이미 끝난 상태이므로 이메일 검증 신호에 기댈 필요가 없다. **네이버도 이 경로로는 안전하게 연결된다.**

연결 해제는 **마지막 로그인 수단이면 거부**된다 — 비밀번호가 없는 계정에서 마지막 소셜 연결을 끊으면 그 계정으로 들어올 방법이 사라진다. 이때는 비밀번호 찾기로 비밀번호를 먼저 만든다.

### 5-5. `AUTH_SOCIAL_STATE_INVALID` (400)

`state` 가 만료(기본 10분)됐거나, 이미 쓴 것이거나, 위조됐다. 사용자가 동의 화면을 오래 열어 두면 자연스럽게 난다 — 로그인 화면으로 돌려보내고 다시 시작하게 하면 된다.

**같은 콜백 URL 을 두 번 열어도 난다.** 브라우저 뒤로가기로 콜백 페이지를 다시 여는 경우가 대표적이다. state 는 1회용이라 그렇다.

### 5-6. provider 가 404 로 나온다

`enabled: true` 인데도 404 면 `client-id` 가 비어 있는 것이다. 설정한 값이 실제로 주입됐는지(환경변수 오타·따옴표) 확인한다.

---

## 6. 운영 점검 목록

| | 확인 |
|---|------|
| ☐ | Microsoft `tenant` 가 `common` 이 아닌가 (사내 시스템인 경우) |
| ☐ | Google 동의 화면 User Type 이 의도한 값인가 — `외부` 는 아무 Google 계정이나 통과한다 |
| ☐ | Google `외부` + `테스트` 상태로 남아 있지 않은가 (테스트 사용자만 로그인된다) |
| ☐ | `auto-signup` 이 의도한 값인가 — 켜면 그 provider 계정을 가진 누구나 들어온다 |
| ☐ | 운영 도메인의 Redirect URI 가 provider 콘솔에 등록됐는가 |
| ☐ | `client-secret` 이 코드·로그·이미지에 들어가지 않았는가 |
| ☐ | 쿠키가 `httpOnly` + `secure` + `sameSite` 인가 |
| ☐ | 소셜로만 가입한 사용자가 비밀번호를 만들 수 있는 경로가 있는가 (비밀번호 찾기) |

---

## 관련 문서

- 계약: [`docs/contract/http-api.md`](../contract/http-api.md) §2-2 — 엔드포인트·응답 형식
- 설정: [`docs/contract/config.md`](../contract/config.md) §5-3
- 에러 코드: [`docs/contract/errors.md`](../contract/errors.md)
- 참조 구현: [`examples/react-demo/`](../../examples/react-demo/)
