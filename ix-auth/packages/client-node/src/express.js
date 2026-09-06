/**
 * Express 미들웨어.
 *
 * 앱이 붙일 것은 두 가지뿐이다 — `authenticate` 와 `requirePermission`.
 */

import { clientMetaFrom } from './client-ip.js'

export const ACCESS_COOKIE = 'ixauth_at'
export const REFRESH_COOKIE = 'ixauth_rt'

/**
 * 쿠키의 토큰을 <b>로컬 검증</b>해 `req.claims` 를 세운다.
 *
 * <p>만료됐을 때만 jar 에 refresh 를 요청한다. 그 외에는 네트워크를 타지 않는다.</p>
 *
 * @param client createIxAuthClient 결과
 * @param opts   { cookieNames, cookieOptions, onUnauthorized }
 */
export function authenticate(client, opts = {}) {
  const accessCookie = opts.cookieNames?.access ?? ACCESS_COOKIE
  const refreshCookie = opts.cookieNames?.refresh ?? REFRESH_COOKIE
  const cookieOptions = opts.cookieOptions ?? { httpOnly: true, sameSite: 'lax', secure: true, path: '/' }

  const reject = opts.onUnauthorized ?? ((res, code, message) =>
    res.status(401).json({ error: { code, message } }))

  return async function ixAuthAuthenticate(req, res, next) {
    const token = req.cookies?.[accessCookie] ?? bearer(req)
    if (!token) return reject(res, 'NO_TOKEN', '로그인이 필요합니다.')

    try {
      req.claims = await client.verifyToken(token)          // 네트워크 없음
      await client.refreshMapIfStale(req.claims)
      return next()
    } catch {
      // 만료·서명 불일치 — refresh 로 살려 본다 (이때만 jar 를 부른다)
      const rt = req.cookies?.[refreshCookie]
      if (!rt) return reject(res, 'TOKEN_INVALID', '다시 로그인하세요.')

      try {
        // 갱신도 감사에 남는다. meta 를 빼면 그 줄의 IP 가 앱 서버 주소로 찍힌다
        const r = await client.refresh(rt, requestMeta(req))
        res.cookie(accessCookie, r.accessToken, { ...cookieOptions, maxAge: r.expiresIn * 1000 })
        res.cookie(refreshCookie, r.refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 3600 * 1000 })
        req.claims = await client.verifyToken(r.accessToken)
        await client.refreshMapIfStale(req.claims)
        return next()
      } catch (e) {
        res.clearCookie(accessCookie, cookieOptions)
        res.clearCookie(refreshCookie, cookieOptions)
        return reject(res, e.code ?? 'SESSION_EXPIRED', '다시 로그인하세요.')
      }
    }
  }
}

/**
 * L1 권한을 요구한다. <b>로컬 판정</b>이므로 네트워크를 타지 않는다.
 *
 * <p>거부 응답에 "무엇이 없어서 막혔는지" 를 담지 않는다 — 권한 구조가 노출된다.</p>
 */
export function requirePermission(client, code) {
  return function ixAuthRequirePermission(req, res, next) {
    if (!client.hasPermission(req.claims, code)) {
      return res.status(403).json({ error: { code: 'AUTHZ_FORBIDDEN', message: '권한이 없습니다.' } })
    }
    next()
  }
}

/**
 * L2 인스턴스 권한을 요구한다. jar 를 호출하므로 파일·문서 접근처럼 빈도가 낮은 경로에만 쓴다.
 *
 * @param resolve (req) => { resourceType, resourceKey, action }
 * @param opts    { fallback: 'deny' | 'l1' } — jar 미도달 시 동작. 기본 deny(fail-secure)
 */
export function requireResourcePermission(client, resolve, opts = {}) {
  const fallback = opts.fallback ?? 'deny'

  return async function ixAuthRequireResource(req, res, next) {
    const { resourceType, resourceKey, action } = resolve(req)
    try {
      const d = await client.check(req.claims?.sub, resourceType, resourceKey, action)
      if (d.allowed) return next()
      return res.status(403).json({ error: { code: 'AUTHZ_FORBIDDEN', message: '권한이 없습니다.' } })
    } catch (e) {
      if (e.code === 'IXAUTH_UNREACHABLE' && fallback === 'l1') {
        // 가용성을 우선하는 앱은 L1 광역 권한으로 폴백할 수 있다
        const code = `${resourceType}:${String(resourceKey).replace(/^\//, '')}:${action}`
        if (client.hasPermission(req.claims, code)) return next()
      }
      return res.status(e.code === 'IXAUTH_UNREACHABLE' ? 503 : 403)
        .json({ error: { code: e.code ?? 'AUTHZ_FORBIDDEN', message: '권한을 확인할 수 없습니다.' } })
    }
  }
}

function bearer(req) {
  const h = req.get?.('Authorization') ?? req.headers?.authorization
  return h?.startsWith('Bearer ') ? h.slice(7) : null
}

/**
 * 요청에서 `{ ip, userAgent }` 를 뽑는다.
 *
 * `req.ip` 를 쓰지 않는다. Express 의 `trust proxy` 는 X-Forwarded-For 만 보므로
 * Cloudflare 뒤에서는 엣지 주소를 준다 (docs/guides/client-ip.md).
 */
export function requestMeta(req) {
  return clientMetaFrom(req.headers, req.socket?.remoteAddress)
}
