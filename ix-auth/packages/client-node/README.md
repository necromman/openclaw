# @ix-auth/client-node

IX-Auth 앱 측 클라이언트 (Node).

**하는 일은 네 가지뿐이다.** 인증 로직을 앱에 다시 구현하지 않게 하는 것이 목적이므로, 이 이상 커지지 않는다.

| # | 하는 일 | jar 호출 |
|---|---------|---------|
| 1 | 로그인·갱신·로그아웃 중계 | ✅ (사용자당 하루 몇 번) |
| 2 | **JWKS 공개키로 토큰 로컬 검증** | ❌ **없음** |
| 3 | **L1 권한 로컬 판정** (permission-map 캐시) | ❌ **없음** |
| 4 | L2 인스턴스 권한 판정 | ✅ (파일·문서 접근 시) |

jar 가 잠시 내려가도 ①④만 막히고, **이미 로그인한 사용자의 ②③은 그대로 동작한다** (설계 불변식 2).

---

## 설치

```bash
npm install @ix-auth/client-node
```

## 사용

```js
import express from 'express'
import cookieParser from 'cookie-parser'
import { createIxAuthClient, authenticate, requirePermission, requestMeta } from '@ix-auth/client-node'

const app = express()
app.use(express.json())
app.use(cookieParser())

const ixauth = createIxAuthClient()   // IXAUTH_* env 로 구성
await ixauth.loadPermissionMap()      // 부팅 시 1회

const auth = authenticate(ixauth)

// 로그인은 앱이 중계한다 — 브라우저는 jar 를 직접 보지 않는다
app.post('/api/login', async (req, res) => {
  // requestMeta(req) 가 { ip, userAgent } 를 준다. req.ip 를 쓰지 않는다 (아래 "실방문자 IP")
  const r = await ixauth.login(req.body.email, req.body.password, requestMeta(req))
  res.cookie('ixauth_at', r.accessToken, { httpOnly: true, sameSite: 'lax', secure: true })
  res.cookie('ixauth_rt', r.refreshToken, { httpOnly: true, sameSite: 'lax', secure: true })
  res.json({ user: r.user })
})

// 로그아웃도 감사에 남는다. 갱신·로그아웃까지 meta 를 넘긴다
app.post('/api/logout', async (req, res) => {
  await ixauth.logout(req.cookies.ixauth_rt, requestMeta(req))
  res.clearCookie('ixauth_at'); res.clearCookie('ixauth_rt')
  res.status(204).end()
})

// 보호된 라우트 — 권한 판정은 로컬에서 일어난다
app.get('/api/reports', auth, requirePermission(ixauth, 'page:reports:view'), (req, res) => {
  res.json({ user: req.claims.email })
})
```

## 설정

| env | 설명 |
|-----|------|
| `IXAUTH_BASE_URL` | jar 주소 (내부 통신). 기본 `http://localhost:9100` |
| `IXAUTH_SERVICE_KEY` | 앱→jar 공유 시크릿. **브라우저로 내보내지 않는다** |
| `IXAUTH_JWT_ISSUER` | 토큰 `iss` 검증값 |

`createIxAuthClient({ baseUrl, serviceKey, issuer })` 로 직접 넘겨도 된다.

---

## API

### 클라이언트

```js
// meta = { ip, userAgent } 다. 세 호출 전부에 넘긴다. requestMeta(req) 로 만든다
await ixauth.login(email, password, meta)
await ixauth.refresh(refreshToken, meta)
await ixauth.logout(refreshToken, meta)

// 로그인을 마무리하는 나머지 경로도 같다
await ixauth.verifyMfa(challenge, code, meta)
await ixauth.magicLinkVerify(token, meta)
await ixauth.socialCallback(provider, code, state, meta)

clientIpFrom(headers, fallback)     // 헤더 묶음에서 실방문자 IP 한 개
clientMetaFrom(headers, fallback)   // { ip, userAgent }
requestMeta(req)                    // Express 요청용 단축

await ixauth.verifyToken(token)          // 로컬. 네트워크 없음
await ixauth.loadPermissionMap()
await ixauth.refreshMapIfStale(claims)   // 토큰 pv > 캐시 버전이면 갱신
ixauth.hasPermission(claims, 'page:reports:view')   // 로컬 판정
ixauth.effectivePermissions(claims)

await ixauth.check(userId, 'file', '/contracts/a.pdf', 'download')
await ixauth.batchCheck(userId, [{ resourceType, resourceKey, action }, ...])
await ixauth.listResources(userId, 'file', 'download')
```

### 미들웨어

| 미들웨어 | 판정 위치 |
|---------|----------|
| `authenticate(client, opts)` | **로컬** (만료 시에만 refresh 로 jar 호출) |
| `requirePermission(client, code)` | **로컬** |
| `requireResourcePermission(client, resolve, { fallback })` | jar 조회 |

`fallback: 'l1'` 을 주면 jar 미도달 시 L1 광역 권한으로 폴백한다. 기본은 `'deny'`(fail-secure).

---

## 실방문자 IP

IX-Auth 는 앱 뒤에 있어서 방문자의 주소를 스스로 알 수 없다. **앱이 넘기는 값이 유일한 근거**이고, 잘못 넘기면 감사 로그와 세션 목록에 경유지 주소가 박힌 채로 굳는다(사후에 진짜 주소를 되찾을 방법이 없다).

`clientIpFrom` 은 이 순서로 고른다.

| 순서 | 출처 | 언제 채워지나 |
|---|---|---|
| 1 | `CF-Connecting-IP` | Cloudflare 를 거칠 때 |
| 2 | `True-Client-IP` | Akamai · Cloudflare Enterprise |
| 3 | `X-Forwarded-For` 첫 조각 | 일반 리버스 프록시 |
| 4 | `X-Real-IP` | nginx 기본 설정 |
| 5 | 소켓 주소 | 프록시가 없을 때 |

CDN 이 없으면 1·2 가 비어 있어 자연히 3 으로 떨어진다. 그래서 **어느 환경이든 이 함수 하나만 쓰면 된다.**

```js
import { clientIpFrom, clientMetaFrom, requestMeta } from '@ix-auth/client-node'

clientIpFrom(req.headers, req.socket?.remoteAddress)   // Express · Node http
clientIpFrom(request.headers)                          // fetch Request · Next.js
requestMeta(req)                                       // { ip, userAgent }
```

### 하면 안 되는 것

```js
const r = await ixauth.login(email, password, { ip: req.ip })              // ❌
const r = await ixauth.login(email, password, { ip: xff.split(',')[0] })   // ❌
```

`req.ip` 는 `trust proxy` 를 켜도 **X-Forwarded-For 만** 본다. Cloudflare 뒤에서는 그 자리가 엣지 서버 주소로 채워져 나가는 구성이 흔해서, 로그인 기록이 전부 Cloudflare IP 로 남는다. 2026-08-25 에 이 SDK 를 쓰는 프로젝트 두 곳에서 동시에 발견된 실제 사고다. 경위와 검수 절차는 [`docs/guides/client-ip.md`](../../docs/guides/client-ip.md).

> 갱신·로그아웃은 요청 본문에 `ip` 칸이 없다. SDK 가 `meta.ip` 를 `X-Forwarded-For` 헤더로 실어 보내고 jar 가 그것을 읽는다. **호출 방법은 로그인과 똑같이 meta 를 넘기는 것뿐이다.**

---

## 지켜야 할 것

1. **목록 화면에서 `check` 를 항목마다 부르지 않는다.** `batchCheck` 또는 `listResources` 를 쓴다
2. **서비스 키를 브라우저로 내보내지 않는다.** 앱 서버만 안다
3. **토큰은 HttpOnly 쿠키로** 심는다. JS 가 읽을 수 있으면 XSS 로 샌다
4. **로그인·갱신·로그아웃 모두 `meta` 를 넘긴다.** IP 는 반드시 `clientIpFrom`/`requestMeta` 로 뽑는다 (위 "실방문자 IP")
5. 권한 코드 매칭은 서버(`PermissionMatcher.java`)와 **같은 규칙**이어야 한다. 계약(`docs/contract/authz.md` §2)을 바꿀 때 양쪽을 함께 고친다

## 예제

`examples/react-demo` — React + Vite + 이 패키지를 쓰는 BFF.
