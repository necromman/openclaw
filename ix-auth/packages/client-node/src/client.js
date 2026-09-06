import { createRemoteJWKSet, jwtVerify } from 'jose'
import { anyMatches } from './permissions.js'
import { clientIpFrom } from './client-ip.js'

/**
 * IX-Auth 앱 측 클라이언트.
 *
 * 하는 일은 네 가지뿐이다:
 *   1. 로그인/갱신/로그아웃을 jar 로 중계
 *   2. JWKS 공개키로 토큰을 <b>로컬 검증</b>  ← 매 요청 jar 를 부르지 않는다 (설계 불변식 2)
 *   3. permission-map 캐시로 L1 권한을 <b>로컬 판정</b>
 *   4. L2 인스턴스 권한만 jar 에 물어본다 (파일·문서 접근처럼 빈도가 낮은 경로)
 *
 * jar 가 잠시 내려가도 ①④만 막히고, 이미 로그인한 사용자의 ②③은 그대로 동작한다.
 */
export function createIxAuthClient(options = {}) {
  const baseUrl = (options.baseUrl ?? process.env.IXAUTH_BASE_URL ?? 'http://localhost:9100')
    .replace(/\/$/, '')
  const serviceKey = options.serviceKey ?? process.env.IXAUTH_SERVICE_KEY ?? ''
  const issuer = options.issuer ?? process.env.IXAUTH_JWT_ISSUER
  const audience = options.audience ?? process.env.IXAUTH_JWT_AUDIENCE ?? issuer
  const clockTolerance = options.clockTolerance ?? 60

  if (!issuer) throw new Error('IX-Auth: issuer 가 필요합니다 (IXAUTH_JWT_ISSUER)')
  if (!serviceKey) throw new Error('IX-Auth: serviceKey 가 필요합니다 (IXAUTH_SERVICE_KEY)')

  // jose 가 공개키를 캐싱하고, 모르는 kid 를 만나면 쿨다운을 두고 한 번만 다시 받는다
  const jwks = createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`), {
    cooldownDuration: options.jwksCooldownMs ?? 30_000,
    cacheMaxAge: options.jwksCacheMs ?? 10 * 60_000,
  })

  let permissionMap = { version: 0, roles: {} }

  async function call(path, init = {}) {
    // accessToken 은 fetch 옵션이 아니라 우리 확장이다 — 그대로 넘기면 무시되므로
    // 분리해서 Authorization 헤더로 만든다. 빠뜨리면 인증 없이 나가 401 이 난다
    const { accessToken, meta, ...rest } = init
    let res
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...rest,
        headers: {
          'Content-Type': 'application/json',
          'X-IxAuth-Key': serviceKey,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...metaHeaders(meta),
          ...(init.headers ?? {}),
        },
      })
    } catch (cause) {
      const err = new Error('IX-Auth 에 연결할 수 없습니다.')
      err.status = 503
      err.code = 'IXAUTH_UNREACHABLE'
      err.cause = cause
      throw err
    }
    const body = res.status === 204 ? null : await res.json().catch(() => null)
    if (!res.ok) {
      const err = new Error(body?.error?.message ?? `IX-Auth 호출 실패 (${res.status})`)
      err.status = res.status
      err.code = body?.error?.code ?? 'INTERNAL'
      // meta 를 버리면 2단계 로그인이 성립하지 않는다 — AUTH_MFA_REQUIRED 는
      // 여기에 challenge 를 실어 보내고, 앱은 그것으로 /auth/mfa/verify 를 부른다
      err.meta = body?.error?.meta ?? null
      // 필드별 사유 (비밀번호 정책 위반·약관 미동의 등)
      err.details = body?.error?.details ?? null
      err.traceId = body?.error?.traceId ?? null
      throw err
    }
    return body?.data ?? null
  }

  return {
    baseUrl,

    // ── 1) 인증 중계 ──
    // meta 는 `{ ip, userAgent }` 다. **세 호출 전부에 넘긴다.** 빼먹으면 감사
    // 기록에 앱 서버의 주소가 박힌다. IP 는 clientIpFrom() 으로 뽑는다
    login: (email, password, meta = {}) =>
      call('/auth/login', {
        method: 'POST', meta,
        body: JSON.stringify({ email, password, ip: meta.ip, userAgent: meta.userAgent }),
      }),

    /**
     * 갱신. 본문에 ip 칸이 없으므로 meta 는 X-Forwarded-For 헤더로 나간다.
     * 갱신도 세션 기록을 갱신하므로 빼먹으면 그 자리가 경유지 주소로 덮인다
     */
    refresh: (refreshToken, meta = {}) =>
      call('/auth/refresh', { method: 'POST', meta, body: JSON.stringify({ refreshToken }) }),

    logout: (refreshToken, meta = {}) =>
      call('/auth/logout', { method: 'POST', meta, body: JSON.stringify({ refreshToken }) }),

    // ── 2) 토큰 로컬 검증 (네트워크 없음) ──
    async verifyToken(token) {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience, clockTolerance })
      return payload
    },

    // ── 3) L1 권한 (로컬 판정) ──
    async loadPermissionMap() {
      const data = await call('/authz/permission-map')
      permissionMap = { version: data.version, roles: data.roles }
      return permissionMap
    },

    /** 토큰의 pv 가 캐시보다 크면 맵이 낡았다 — 폴링 없이 이 신호만으로 갱신 */
    async refreshMapIfStale(claims) {
      const pv = Number(claims?.ixauth_pv ?? 0)
      if (pv > permissionMap.version) {
        await this.loadPermissionMap()
        return true
      }
      return false
    },

    hasPermission(claims, requiredCode) {
      const roles = claims?.ixauth_roles ?? []
      const granted = roles.flatMap((r) => permissionMap.roles[r] ?? [])
      return anyMatches(granted, requiredCode)
    },

    effectivePermissions(claims) {
      const roles = claims?.ixauth_roles ?? []
      return [...new Set(roles.flatMap((r) => permissionMap.roles[r] ?? []))].sort()
    },

    permissionMapVersion: () => permissionMap.version,

    // ── 4) L2 인스턴스 권한 (jar 조회) ──

    // ── 계정 라이프사이클 ──
    // forgot·requestEmailVerification 은 계정이 없어도 성공한다. 그것이 계약이다 —
    // 다르게 답하면 그 화면이 가입자 명부 조회 도구가 된다
    forgotPassword: (email) =>
      call('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),

    resetPassword: (token, newPassword) =>
      call('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),

    /** access token 이 필요하다 — 서비스 키만으로는 남의 비밀번호를 바꿀 수 없다 */
    changePassword: (accessToken, currentPassword, newPassword) =>
      call('/auth/password/change', {
        method: 'POST', accessToken,
        body: JSON.stringify({ currentPassword, newPassword }),
      }),

    requestEmailVerification: (email) =>
      call('/auth/email/verify/request', { method: 'POST', body: JSON.stringify({ email }) }),

    verifyEmail: (token) =>
      call('/auth/email/verify', { method: 'POST', body: JSON.stringify({ token }) }),

    changeEmail: (accessToken, newEmail, currentPassword) =>
      call('/auth/email/change', {
        method: 'POST', accessToken, body: JSON.stringify({ newEmail, currentPassword }),
      }),

    acceptInvite: (token, password, name) =>
      call('/auth/invite/accept', { method: 'POST', body: JSON.stringify({ token, password, name }) }),

    /**
     * 자체 가입.
     *
     * @param opts.agreements  약관 동의 — `{ service: true, marketing: false }`.
     *   **보내지 않으면 무동의 계정이 된다.** 필수 약관이 게시돼 있으면 서버가
     *   AUTH_TERMS_REQUIRED 로 막지만, 그 설정이 꺼져 있으면 조용히 통과한다
     * @param opts.attributes  사용자 속성 (부서·사번 등)
     * @param opts.captchaToken CAPTCHA 를 켰다면 필수
     */
    signup: (email, password, name, opts = {}) =>
      call('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email, password, name,
          agreements: opts.agreements,
          attributes: opts.attributes,
          captchaToken: opts.captchaToken,
        }),
      }),

    // ── 소셜 로그인 ──
    // 콜백은 앱이 받는다. IX-Auth 는 외부에 노출되지 않으므로 provider 가
    // 브라우저를 IX-Auth 로 돌려보낼 수 없다 (설계 불변식 4)
    socialProviders: () => call('/auth/social/providers'),

    socialAuthorizeUrl: (provider, redirectUri) =>
      call(`/auth/social/${provider}/authorize-url`
        + `?redirectUri=${encodeURIComponent(redirectUri)}`),

    /** 앱이 콜백에서 받은 code 를 그대로 넘긴다. 로그인이므로 meta 를 넣는다 */
    socialCallback: (provider, code, state, meta = {}) =>
      call(`/auth/social/${provider}/callback`,
        { method: 'POST', meta, body: JSON.stringify({ code, state }) }),

    /** 로그인한 사용자가 자기 계정에 연결 — 가장 안전한 경로 */
    socialLink: (accessToken, provider, code, state) =>
      call(`/auth/social/${provider}/link`,
        { method: 'POST', accessToken, body: JSON.stringify({ code, state }) }),

    socialLinks: (accessToken) => call('/auth/social/links', { accessToken }),

    socialUnlink: (accessToken, provider) =>
      call(`/auth/social/${provider}/link`, { method: 'DELETE', accessToken }),

    // ── 2단계 인증 (MFA) ──
    // 로그인이 AUTH_MFA_REQUIRED 로 실패하면 err.meta.challenge 를 들고 verifyMfa 를 부른다

    mfaSetup: (accessToken) =>
      call('/auth/mfa/totp/setup', { method: 'POST', accessToken, body: '{}' }),

    mfaConfirm: (accessToken, code) =>
      call('/auth/mfa/totp/confirm',
        { method: 'POST', accessToken, body: JSON.stringify({ code }) }),

    /** 2단계 검증. code 자리에 백업 코드도 넣을 수 있다. 이 호출이 로그인을 마무리한다 */
    verifyMfa: (challenge, code, meta = {}) =>
      call('/auth/mfa/verify', { method: 'POST', meta, body: JSON.stringify({ challenge, code }) }),

    mfaStatus: (accessToken) => call('/auth/mfa/status', { accessToken }),

    /** 해제. mfa.mode 가 REQUIRED_* 면 본인은 끌 수 없다(403) */
    mfaDisable: (accessToken, currentPassword, mfaCode) =>
      call('/auth/mfa/totp', {
        method: 'DELETE', accessToken,
        body: JSON.stringify({ currentPassword, mfaCode }),
      }),

    // ── 약관 ──

    /** 게시된 약관 목록. 가입 화면은 로그인 전이라 서비스 키로 부른다 */
    terms: () => call('/auth/terms'),

    /** @param agreements `{ service: true, marketing: false }` */
    agreeTerms: (accessToken, agreements) =>
      call('/auth/terms/agree',
        { method: 'POST', accessToken, body: JSON.stringify({ agreements }) }),

    myAgreements: (accessToken) => call('/auth/terms/agreements', { accessToken }),

    // ── 매직 링크 ──

    /** 계정이 없어도 성공한다 — 그것이 계약이다 */
    magicLinkRequest: (email, captchaToken) =>
      call('/auth/magic-link/request',
        { method: 'POST', body: JSON.stringify({ email, captchaToken }) }),

    magicLinkVerify: (token, meta = {}) =>
      call('/auth/magic-link/verify', { method: 'POST', meta, body: JSON.stringify({ token }) }),

    // ── 내 세션 ──
    listSessions: (accessToken) => call('/auth/sessions', { accessToken }),
    revokeSession: (accessToken, sessionId) =>
      call(`/auth/sessions/${sessionId}`, { method: 'DELETE', accessToken }),
    revokeAllSessions: (accessToken) => call('/auth/sessions', { method: 'DELETE', accessToken }),

    /** 단건 판정. 목록 화면에서는 batchCheck / listResources 를 쓴다 (N+1 금지) */
    check: (userId, resourceType, resourceKey, action) =>
      call('/authz/check', {
        method: 'POST',
        body: JSON.stringify({ userId, resourceType, resourceKey, action }),
      }),

    batchCheck: (userId, checks) =>
      call('/authz/batch-check', { method: 'POST', body: JSON.stringify({ userId, checks }) }),

    listResources: (userId, resourceType, action = 'read') =>
      call(`/authz/list-resources?userId=${userId}`
        + `&resourceType=${encodeURIComponent(resourceType)}`
        + `&action=${encodeURIComponent(action)}`),
  }
}

/**
 * meta 를 헤더로 바꿔 실어 보낸다.
 *
 * jar 는 본문 ip 가 없으면 X-Forwarded-For 첫 조각을 보기 때문에(ClientInfo.java),
 * 본문에 ip 칸이 없는 갱신·로그아웃은 이 헤더 하나로 실방문자 주소가 전달된다.
 * jar 는 앱만 부를 수 있으므로(설계 불변식 4) 이 헤더를 신뢰하는 것이 설계 의도다.
 */
function metaHeaders(meta) {
  if (!meta) return {}
  const ip = clientIpFrom(null, meta.ip)
  return {
    ...(ip ? { 'X-Forwarded-For': ip } : {}),
    ...(meta.userAgent ? { 'User-Agent': String(meta.userAgent) } : {}),
  }
}
