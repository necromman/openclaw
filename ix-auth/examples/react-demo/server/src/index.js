/**
 * 데모 앱의 BFF.
 *
 * 브라우저는 IX-Auth jar 를 직접 호출하지 않는다 (설계 불변식 4).
 * 이 서버가 중계하고, 토큰은 <b>앱 도메인 쿠키</b>로 심는다.
 * 서비스 키도 여기에만 있고 브라우저로 나가지 않는다.
 *
 * 인증 로직은 직접 짜지 않는다 — @ix-auth/client-node 를 그대로 쓴다.
 */
import express from 'express'
import cookieParser from 'cookie-parser'
import {
  createIxAuthClient,
  authenticate,
  requirePermission,
  requireResourcePermission,
  requestMeta,
} from '@ix-auth/client-node'

const app = express()
const PORT = Number(process.env.PORT ?? 8080)

// 리버스 프록시 뒤에서 최종 사용자 IP 를 얻으려면 필요하다.
// 다만 감사 IP 는 req.ip 가 아니라 requestMeta(req) 로 뽑는다. trust proxy 는
// X-Forwarded-For 만 보므로 CDN 뒤에서는 엣지 주소를 준다 (docs/guides/client-ip.md).
app.set('trust proxy', true)

app.use(express.json())
app.use(cookieParser())

const ixauth = createIxAuthClient()   // IXAUTH_* env 로 구성

const ACCESS = 'demo_at'
const REFRESH = 'demo_rt'
const cookieOpts = {
  httpOnly: true,     // JS 로 못 읽는다 — XSS 로 토큰이 새지 않게
  sameSite: 'lax',
  secure: false,      // 데모는 http. 운영에서는 반드시 true
  path: '/',
}

/**
 * 소셜 provider 콘솔에 등록하는 Redirect URI 의 뿌리.
 *
 * <b>BFF 포트가 아니라 브라우저가 실제로 여는 주소</b>다. 개발 중에는 Vite 가 그 주소이고
 * `/oauth` 를 BFF 로 프록시한다(web/vite.config.ts). 여기에 BFF 주소를 적으면 provider 가
 * 사용자를 화면이 없는 포트로 돌려보내 흰 화면이 뜬다.
 */
const APP_BASE_URL = (process.env.APP_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const callbackUri = (provider, suffix = '') => `${APP_BASE_URL}/oauth/${provider}${suffix}`

/** 로컬 검증 계측 — jar 를 안 거친다는 것을 화면에서 보여주기 위함 */
let localVerifyCount = 0

const auth = authenticate(ixauth, {
  cookieNames: { access: ACCESS, refresh: REFRESH },
  cookieOptions: cookieOpts,
})

/** 계측만 덧붙인 래퍼 */
function authenticated(req, res, next) {
  auth(req, res, (err) => {
    if (!err && req.claims) localVerifyCount += 1
    next(err)
  })
}

/**
 * 화면 이동(navigation)으로 들어오는 경로용 인증.
 *
 * 소셜 연결처럼 <b>브라우저가 주소창으로 여는</b> 경로는 401 JSON 을 돌려주면
 * 사용자가 날 JSON 을 보게 된다. 같은 검증을 하되 화면으로 돌려보낸다.
 */
const authenticatedPage = authenticate(ixauth, {
  cookieNames: { access: ACCESS, refresh: REFRESH },
  cookieOptions: cookieOpts,
  onUnauthorized: (res) => res.redirect('/?error=login-required'),
})

/**
 * 지금 유효한 access token.
 *
 * `authenticate` 는 만료된 토큰을 refresh 로 살리는데, 그렇게 <b>새로 받은 토큰은
 * 응답의 Set-Cookie 에만 있고</b> `req.cookies` 는 옛 값 그대로다. 그걸 그대로 jar 에
 * 보내면 방금 되살아난 세션이 401 을 받는다 — 토큰 수명이 짧을수록 자주 난다.
 */
function accessTokenOf(req, res) {
  const set = [].concat(res.getHeader('Set-Cookie') ?? [])
  const fresh = set.map(String).find((c) => c.startsWith(`${ACCESS}=`))
  if (!fresh) return req.cookies?.[ACCESS]
  return decodeURIComponent(fresh.slice(ACCESS.length + 1).split(';')[0])
}

/**
 * 실패 응답. <b>jar 의 원문을 그대로 흘리지 않는다.</b>
 *
 * 원문에는 "이미 사용 중인 이메일" 처럼 계정 존재를 드러내는 문장이 섞여 있다.
 * 본인이 조치할 수 있는 것만 앱이 문구를 정해 쓰고, 나머지는 뭉뚱그린다.
 */
function fail(res, e, byCode = {}) {
  const message = byCode[e.code]
    ?? (e.code === 'IXAUTH_UNREACHABLE' ? '지금은 처리할 수 없습니다. 잠시 뒤 다시 시도하세요.' : null)
    ?? '요청을 처리하지 못했습니다.'
  res.status(e.status ?? 500).json({ code: e.code ?? 'INTERNAL', message })
}

/**
 * 경로로 들어온 provider 이름을 그대로 jar URL 에 붙이지 않는다 —
 * `../` 같은 값이 섞이면 엉뚱한 엔드포인트를 부르게 된다.
 */
function providerOf(req) {
  const p = String(req.params.provider ?? '').toLowerCase()
  return /^[a-z]+$/.test(p) ? p : null
}

// ─────────────────────────── 인증 ───────────────────────────

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  try {
    // requestMeta 가 CF-Connecting-IP → True-Client-IP → XFF 첫 조각 → X-Real-IP →
    // 소켓 주소 순으로 실방문자 IP 를 고른다. 이 값이 감사 로그에 그대로 남는다
    const r = await ixauth.login(email, password, requestMeta(req))
    res.cookie(ACCESS, r.accessToken, { ...cookieOpts, maxAge: r.expiresIn * 1000 })
    res.cookie(REFRESH, r.refreshToken, { ...cookieOpts, maxAge: 7 * 24 * 3600 * 1000 })

    const claims = await ixauth.verifyToken(r.accessToken)
    await ixauth.refreshMapIfStale(claims)     // 권한이 바뀌었으면 이때 갱신

    res.json({ user: r.user })
  } catch (e) {
    res.status(e.status ?? 500).json({ code: e.code ?? 'INTERNAL', message: e.message })
  }
})

app.post('/api/logout', async (req, res) => {
  const rt = req.cookies?.[REFRESH]
  try {
    // 로그아웃도 감사에 남는다. 갱신·로그아웃까지 meta 를 넘긴다
    if (rt) await ixauth.logout(rt, requestMeta(req))
  } catch {
    // 로그아웃은 멱등 — 실패해도 쿠키는 지운다
  }
  res.clearCookie(ACCESS, cookieOpts)
  res.clearCookie(REFRESH, cookieOpts)
  res.status(204).end()
})

// ──────────────────── 계정 (비밀번호 찾기·세션) ────────────────────
//
// 앱이 중계한다. 브라우저는 IX-Auth 를 직접 부르지 않는다 (설계 불변식 4).

/** 계정이 없어도 성공한다. 그것이 계약이다 — 다르게 답하면 가입자 명부가 샌다 */
app.post('/api/password/forgot', async (req, res) => {
  try {
    await ixauth.forgotPassword(req.body?.email)
  } catch (e) {
    // 메일 발송 실패도 사용자에게는 같은 응답이어야 한다
    if (e.code === 'IXAUTH_UNREACHABLE') return res.status(503).json({ code: e.code })
  }
  res.json({ accepted: true })
})

app.post('/api/password/reset', async (req, res) => {
  try {
    await ixauth.resetPassword(req.body?.token, req.body?.newPassword)
    // 재설정하면 모든 세션이 끊긴다 — 이 브라우저의 쿠키도 정리한다
    res.clearCookie(ACCESS, cookieOpts)
    res.clearCookie(REFRESH, cookieOpts)
    res.json({ accepted: true })
  } catch (e) {
    res.status(e.status ?? 500).json({ code: e.code ?? 'INTERNAL', message: e.message })
  }
})

app.post('/api/password/change', authenticated, async (req, res) => {
  try {
    await ixauth.changePassword(accessTokenOf(req, res),
      req.body?.currentPassword, req.body?.newPassword)
    // 바꾸면 모든 세션이 폐기된다 — 이 브라우저의 쿠키도 같이 정리해야 화면과 서버가 어긋나지 않는다
    res.clearCookie(ACCESS, cookieOpts)
    res.clearCookie(REFRESH, cookieOpts)
    res.json({ accepted: true })
  } catch (e) {
    fail(res, e, {
      // 본인이 고칠 수 있는 두 가지만 사유를 알려 준다
      AUTH_INVALID_CREDENTIALS: '현재 비밀번호가 올바르지 않습니다.',
      VALIDATION_FAILED: '새 비밀번호가 정책에 맞지 않습니다.',
    })
  }
})

/**
 * 이메일 변경 요청 — 확인 메일은 <b>새 주소</b>로 간다. 확인 전까지 주소는 그대로다.
 *
 * 비밀번호를 함께 받는 이유: 자리를 비운 사이 주소만 바꿔치기하면
 * 그 다음 "비밀번호 찾기" 한 번으로 계정을 통째로 가져갈 수 있다.
 */
app.post('/api/email/change', authenticated, async (req, res) => {
  try {
    await ixauth.changeEmail(accessTokenOf(req, res),
      req.body?.newEmail, req.body?.currentPassword)
    res.json({ accepted: true })
  } catch (e) {
    fail(res, e, {
      AUTH_INVALID_CREDENTIALS: '현재 비밀번호가 올바르지 않습니다.',
      // jar 는 "이미 사용 중인 이메일" 이라고 답하지만, 그대로 옮기면 이 화면이
      // 가입 여부 조회 도구가 된다. 할 수 있는 조치("다른 주소")만 알려 준다
      CONFLICT: '그 주소는 사용할 수 없습니다. 다른 주소를 입력하세요.',
      VALIDATION_FAILED: '주소 형식을 확인하세요.',
    })
  }
})

app.post('/api/invite/accept', async (req, res) => {
  try {
    await ixauth.acceptInvite(req.body?.token, req.body?.password, req.body?.name)
    res.json({ accepted: true })
  } catch (e) {
    res.status(e.status ?? 500).json({ code: e.code ?? 'INTERNAL', message: e.message })
  }
})

app.post('/api/email/verify', async (req, res) => {
  try {
    await ixauth.verifyEmail(req.body?.token)
    res.json({ accepted: true })
  } catch (e) {
    res.status(e.status ?? 500).json({ code: e.code ?? 'INTERNAL', message: e.message })
  }
})

app.get('/api/sessions', authenticated, async (req, res) => {
  try {
    res.json(await ixauth.listSessions(accessTokenOf(req, res)))
  } catch (e) {
    fail(res, e)
  }
})

app.delete('/api/sessions/:id', authenticated, async (req, res) => {
  try {
    await ixauth.revokeSession(accessTokenOf(req, res), req.params.id)
    res.json({ accepted: true })
  } catch (e) {
    // 남의 세션 ID 를 넣으면 NOT_FOUND 다 — 소유자를 대조하기 때문이다.
    // "있는데 남의 것" 과 "없음" 을 구분해 주지 않는다
    fail(res, e)
  }
})

// ───────────────────────── 소셜 로그인 ─────────────────────────
//
// 콜백은 **앱**이 받는다. IX-Auth 는 외부에 노출되지 않으므로(설계 불변식 4)
// provider 가 브라우저를 IX-Auth 로 돌려보낼 수 없다. 그래서 provider 콘솔에
// 등록하는 Redirect URI 는 전부 앱 주소(`APP_BASE_URL`)다.

/**
 * 로그인 화면이 <b>어떤 버튼을 그릴지</b> 정하는 데 쓴다.
 *
 * provider 가 하나도 설정돼 있지 않거나 jar 가 아직 안 떴어도 이 응답은 성공해야 한다 —
 * 로그인 화면이 소셜 때문에 통째로 못 뜨면 비밀번호 로그인까지 막힌다.
 */
app.get('/api/social/providers', async (_req, res) => {
  try {
    res.json(await ixauth.socialProviders())
  } catch {
    res.json({ enabled: false, providers: [] })
  }
})

/** ①② 사용자를 provider 동의 화면으로 보낸다 */
app.get('/api/social/:provider/start', async (req, res) => {
  const provider = providerOf(req)
  if (!provider) return res.redirect('/?error=social')
  try {
    const { url } = await ixauth.socialAuthorizeUrl(provider, callbackUri(provider))
    res.redirect(url)
  } catch {
    // 꺼진 provider 인지 jar 가 죽은 것인지 구분해 주지 않는다 — 설정 상태가 드러난다
    res.redirect('/?error=social')
  }
})

/** ④⑤⑦ provider 가 여기로 돌려보낸다 → jar 로 중계 → 토큰을 쿠키로 심는다 */
app.get('/oauth/:provider', async (req, res) => {
  const provider = providerOf(req)
  const { code, state, error } = req.query
  if (!provider || error || !code) return res.redirect('/?error=social')

  try {
    const r = await ixauth.socialCallback(provider, String(code), String(state ?? ''),
      requestMeta(req))

    // 비밀번호 로그인과 똑같이 HttpOnly 쿠키로 심는다. 토큰을 URL 이나 JS 로 넘기면
    // 주소창·리퍼러·XSS 어디로든 샌다
    res.cookie(ACCESS, r.accessToken, { ...cookieOpts, maxAge: r.expiresIn * 1000 })
    res.cookie(REFRESH, r.refreshToken, { ...cookieOpts, maxAge: 7 * 24 * 3600 * 1000 })

    const claims = await ixauth.verifyToken(r.accessToken)
    await ixauth.refreshMapIfStale(claims)

    res.redirect('/')
  } catch (e) {
    // AUTH_SOCIAL_NO_ACCOUNT 의 원인은 셋인데(가이드 5-3) 구분해 주지 않는다 —
    // 구분하면 "그 주소로 가입된 계정이 있다" 가 새어 나간다. 원인은 jar 로그에 남는다
    res.redirect(e.code === 'AUTH_SOCIAL_NO_ACCOUNT' ? '/?error=no-account' : '/?error=social')
  }
})

/** 연결된 소셜 계정 목록 */
app.get('/api/social/links', authenticated, async (req, res) => {
  try {
    res.json({ items: (await ixauth.socialLinks(accessTokenOf(req, res))) ?? [] })
  } catch (e) {
    fail(res, e)
  }
})

/**
 * 로그인한 상태에서 연결한다 — <b>가장 안전한 경로다.</b>
 *
 * 본인 확인이 이미 끝났으므로 provider 의 이메일 검증 신호에 기댈 필요가 없다.
 * 네이버처럼 검증 여부를 주지 않는 provider 도 이 경로로는 안전하게 붙는다.
 */
app.get('/api/social/:provider/link/start', authenticatedPage, async (req, res) => {
  const provider = providerOf(req)
  if (!provider) return res.redirect('/?tab=account&error=link')
  try {
    const { url } = await ixauth.socialAuthorizeUrl(provider, callbackUri(provider, '/link'))
    res.redirect(url)
  } catch {
    res.redirect('/?tab=account&error=link')
  }
})

app.get('/oauth/:provider/link', authenticatedPage, async (req, res) => {
  const provider = providerOf(req)
  const { code, state, error } = req.query
  if (!provider || error || !code) return res.redirect('/?tab=account&error=link')
  try {
    await ixauth.socialLink(accessTokenOf(req, res), provider, String(code), String(state ?? ''))
    res.redirect(`/?tab=account&linked=${encodeURIComponent(provider)}`)
  } catch (e) {
    res.redirect('/?tab=account&error='
      + (e.code === 'AUTH_SOCIAL_ALREADY_LINKED' ? 'link-taken' : 'link'))
  }
})

app.delete('/api/social/:provider/link', authenticated, async (req, res) => {
  const provider = providerOf(req)
  if (!provider) return res.status(404).json({ code: 'NOT_FOUND', message: '연결이 없습니다.' })
  try {
    await ixauth.socialUnlink(accessTokenOf(req, res), provider)
    res.json({ accepted: true })
  } catch (e) {
    fail(res, e, {
      // 자기 계정 이야기라 알려 줘도 새는 것이 없다. 오히려 알려 줘야 조치가 가능하다
      CONFLICT: '마지막 로그인 수단이라 해제할 수 없습니다. 비밀번호를 먼저 만드세요.',
      NOT_FOUND: '연결돼 있지 않습니다.',
    })
  }
})

app.get('/api/me', authenticated, (req, res) => {
  res.json({
    id: req.claims.sub,
    email: req.claims.email,
    name: req.claims.name,
    roles: req.claims.ixauth_roles ?? [],
    groups: req.claims.ixauth_groups ?? [],
    permissions: ixauth.effectivePermissions(req.claims),
    // 이 응답을 만드는 동안 jar 를 부르지 않았다는 증거
    verifiedLocally: true,
    localVerifyCount,
    permissionMapVersion: ixauth.permissionMapVersion(),
    tokenPv: req.claims.ixauth_pv,
    expiresAt: new Date(req.claims.exp * 1000).toISOString(),
  })
})

// ─────────────────────── L1 권한 (로컬 판정) ───────────────────────

app.get('/api/admin-area', authenticated, requirePermission(ixauth, 'ixauth:users:read'), (_req, res) => {
  res.json({ note: 'ixauth:users:read 로 열린 화면 (로컬 판정)' })
})

app.get('/api/reports', authenticated, requirePermission(ixauth, 'page:reports:view'), (_req, res) => {
  res.json({ items: [{ id: 1, title: '월간 리포트' }], note: 'page:reports:view 로 열린 화면' })
})

/** 임의 권한 코드를 즉석에서 판정 (화면 실험용) */
app.get('/api/can', authenticated, (req, res) => {
  const code = String(req.query.code ?? '')
  res.json({ code, allowed: ixauth.hasPermission(req.claims, code) })
})

// ─────────────────── L2 인스턴스 권한 (jar 조회) ───────────────────

/**
 * 파일 다운로드 — 경로별 권한이 필요한 대표 사례.
 *
 * ⚠ Express 5 의 named wildcard(`*path`)는 <b>세그먼트 배열</b>을 준다.
 * 그대로 문자열에 붙이면 `/contracts,2026,a.pdf` 가 되어 판정이 어긋난다.
 */
function filePathOf(req) {
  const p = req.params.path
  return '/' + (Array.isArray(p) ? p.join('/') : (p ?? ''))
}

app.get('/api/files/*path', authenticated,
  requireResourcePermission(ixauth, (req) => ({
    resourceType: 'file',
    resourceKey: filePathOf(req),
    action: 'download',
  })),
  (req, res) => {
    res.json({ file: filePathOf(req), note: 'L2 판정 통과 — 실제 파일 대신 메타만 반환' })
  })

/**
 * 리소스 판정 — `@ix-auth/client-react` 의 `useResourcePermission` 이 부르는 표준 엔드포인트.
 *
 * 브라우저가 IX-Auth 를 직접 부를 수 없으므로(불변식 4) 앱이 이 창구를 연다.
 * 사용자 ID 는 <b>토큰에서 꺼낸다</b> — 클라이언트가 보낸 값을 믿으면 남의 권한을 조회할 수 있다.
 */
app.get('/api/resource-check', authenticated, async (req, res) => {
  try {
    const d = await ixauth.check(
      req.claims.sub,
      String(req.query.type ?? 'file'),
      String(req.query.key ?? ''),
      String(req.query.action ?? 'read'),
    )
    res.json(d)
  } catch (e) {
    res.status(e.status ?? 500).json({ code: e.code, message: e.message })
  }
})

/** 구 경로 — 데모 화면 호환용 */
app.get('/api/file-check', authenticated, async (req, res) => {
  try {
    res.json(await ixauth.check(req.claims.sub, 'file', String(req.query.key ?? ''), 'download'))
  } catch (e) {
    res.status(e.status ?? 500).json({ code: e.code, message: e.message })
  }
})

/** 접근 가능한 파일 목록 — 앱이 자기 쿼리를 필터링하는 데 쓰는 형태 */
app.get('/api/my-files', authenticated, async (req, res) => {
  try {
    res.json(await ixauth.listResources(req.claims.sub, 'file', 'download'))
  } catch (e) {
    res.status(e.status ?? 500).json({ code: e.code, message: e.message })
  }
})

// ─────────────────────────── 상태 ───────────────────────────

/** jar 가 살아 있는지 — "꺼도 세션은 유지된다"를 화면에서 보여주기 위함 */
app.get('/api/ixauth-status', async (_req, res) => {
  try {
    const r = await fetch(`${ixauth.baseUrl}/health`, { signal: AbortSignal.timeout(1500) })
    res.json({ reachable: r.ok, status: r.status })
  } catch {
    res.json({ reachable: false })
  }
})

// ─────────────────────────── 기동 ───────────────────────────

const server = app.listen(PORT, async () => {
  try {
    const map = await ixauth.loadPermissionMap()
    console.log(`[demo-bff] permission-map 로드 — version=${map.version}, `
      + `역할 ${Object.keys(map.roles).length}개`)
  } catch (e) {
    console.warn('[demo-bff] permission-map 로드 실패 (IX-Auth 기동 대기 중?):', e.message)
  }
  console.log(`[demo-bff] http://localhost:${PORT}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
