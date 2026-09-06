/**
 * 실방문자 IP 도출.
 *
 * 앱은 IX-Auth 에게 "누가 로그인했는가" 를 알려 주는 유일한 통로다. 앱이 경유지
 * 주소를 넘기면 감사 로그와 세션 목록에 그 경유지가 박히고, 그렇게 쌓인 기록은
 * 나중에 되돌릴 수 없다(사후에 진짜 주소를 알 방법이 없다).
 *
 * 그래서 우선순위를 이 순서로 고정한다.
 *
 *   1. `CF-Connecting-IP`  : Cloudflare 가 실방문자 주소로 채워 넣는다
 *   2. `True-Client-IP`    : Akamai·Cloudflare Enterprise 가 쓰는 같은 뜻의 헤더
 *   3. `X-Forwarded-For` 의 첫 조각
 *   4. `X-Real-IP`
 *   5. 소켓 주소(fallback 인자)
 *
 * CDN 이 없는 환경이면 1·2 가 비어 있으니 자연히 3(XFF)으로 떨어진다. 즉 이
 * 순서는 CDN 이 있든 없든 그대로 쓰면 된다.
 *
 * 왜 XFF 부터 보면 안 되는가: Cloudflare 뒤에서는 XFF 의 첫 조각이 **엣지 서버
 * 주소**로 채워져 나가는 구성이 흔하다. 그 값을 그대로 믿으면 로그인 기록이
 * 전부 Cloudflare IP 로 남는다(2026-08-25 실측, 소비 프로젝트 2곳 동시 발생).
 * 자세한 경위는 docs/guides/client-ip.md 참고.
 */

/** 앞에 있을수록 믿는다 */
const IP_HEADER_PRIORITY = ['cf-connecting-ip', 'true-client-ip', 'x-forwarded-for', 'x-real-ip']

/**
 * 헤더 묶음에서 실방문자 IP 를 뽑는다.
 *
 * @param headers  `req.headers`(Node) · `Headers`(fetch/Next.js) · `Map` 전부 받는다
 * @param fallback 헤더가 하나도 없을 때 쓸 소켓 주소 (`req.socket?.remoteAddress`)
 * @returns 정규화된 IP 문자열, 못 찾으면 `null`
 */
export function clientIpFrom(headers, fallback) {
  for (const name of IP_HEADER_PRIORITY) {
    const raw = headerValue(headers, name)
    if (!raw) continue
    // XFF 는 "client, proxy1, proxy2" 형식이라 맨 앞만 쓴다
    const ip = normalizeIp(name === 'x-forwarded-for' ? raw.split(',')[0] : raw)
    if (ip) return ip
  }
  return normalizeIp(fallback)
}

/**
 * IX-Auth 호출에 실을 `{ ip, userAgent }` 를 한 번에 만든다.
 *
 * ```js
 * await ixauth.refresh(rt, clientMetaFrom(req.headers, req.socket?.remoteAddress))
 * ```
 */
export function clientMetaFrom(headers, fallback) {
  return {
    ip: clientIpFrom(headers, fallback),
    userAgent: headerValue(headers, 'user-agent'),
  }
}

/** `Headers`·`Map`·평범한 객체를 한 가지 방법으로 읽는다 */
function headerValue(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    return firstOf(headers.get(name))
  }
  const direct = headers[name]
  if (direct !== undefined) return firstOf(direct)
  // 대문자 섞인 키(`X-Forwarded-For`)로 들어온 평범한 객체까지 받아 준다
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return firstOf(v)
  }
  return null
}

/** Node 는 같은 헤더가 여러 번 오면 배열로 준다 */
function firstOf(value) {
  if (Array.isArray(value)) return value.length ? String(value[0]) : null
  return value == null ? null : String(value)
}

/**
 * 포트·IPv6 표기를 서버(`ClientInfo.java`)와 같은 모양으로 맞춘다.
 *
 * 같은 접속이 `::1` 과 `127.0.0.1` 두 가지로 찍히면 감사 로그를 IP 로 묶어 볼 수 없다.
 */
function normalizeIp(value) {
  if (typeof value !== 'string') return null
  let v = value.trim()
  if (!v) return null

  const bracketed = v.match(/^\[([^\]]+)\](?::\d+)?$/)   // [2001:db8::1]:443
  if (bracketed) {
    v = bracketed[1]
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(v)) {  // 203.0.113.7:51514
    v = v.slice(0, v.lastIndexOf(':'))
  }

  if (v.startsWith('::ffff:') && v.includes('.')) v = v.slice('::ffff:'.length)
  if (v === '::1' || v === '0:0:0:0:0:0:0:1') return '127.0.0.1'

  // 프록시가 채우는 `unknown` 같은 값을 그대로 흘려보내지 않는다
  return looksLikeIp(v) ? v : null
}

function looksLikeIp(v) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)) return true
  return v.includes(':') && /^[0-9a-fA-F:.]+$/.test(v)
}
