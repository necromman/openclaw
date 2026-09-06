/**
 * 권한 코드 매칭 — 계약 docs/contract/authz.md §2 의 JS 구현.
 *
 * 서버의 `PermissionMatcher.java` 와 <b>같은 규칙</b>이어야 한다.
 * 둘이 어긋나면 앱과 jar 의 판정이 갈리므로, 계약을 바꿀 때 양쪽을 함께 고친다.
 */

const SEGMENT = /[./]/
const ANY = '*'
const ANY_DEEP = '**'

/** 패턴이 요청 코드를 덮는가 */
export function matches(pattern, required) {
  const p = String(pattern ?? '').split(':')
  const r = String(required ?? '').split(':')
  if (p.length !== 3 || r.length !== 3) return false
  for (let i = 0; i < 3; i++) {
    if (!partMatches(p[i], r[i])) return false
  }
  return true
}

function partMatches(pattern, value) {
  if (pattern === ANY || pattern === ANY_DEEP) return true

  const p = pattern.split(SEGMENT)
  const v = value.split(SEGMENT)

  for (let i = 0; i < p.length; i++) {
    if (p[i] === ANY_DEEP) return v.length > i    // 남은 세그먼트 전부 (최소 1개)
    if (i >= v.length) return false
    if (p[i] !== ANY && p[i] !== v[i]) return false
  }
  // 패턴을 다 썼는데 값이 남으면 불일치 — page:admin.* 는 page:admin.users.detail 을 덮지 않는다
  return p.length === v.length
}

/** 부여된 권한 중 하나라도 걸리면 허용 */
export function anyMatches(granted, required) {
  if (!Array.isArray(granted) || granted.length === 0) return false
  return granted.some((g) => matches(g, required))
}

/** 코드 문법 검증 — 서버 등록 전에 앱에서 미리 걸러낼 때 */
export function validateCode(code) {
  const parts = String(code ?? '').split(':')
  if (parts.length !== 3) {
    throw new Error(`권한 코드는 '<domain>:<resource>:<action>' 3파트여야 합니다: ${code}`)
  }
  for (const part of parts) {
    const segs = part.split(SEGMENT)
    segs.forEach((s, i) => {
      if (s === '') throw new Error(`빈 세그먼트가 있습니다: ${code}`)
      if (s === ANY_DEEP && i !== segs.length - 1) {
        throw new Error(`'**' 는 마지막 세그먼트에만 올 수 있습니다: ${code}`)
      }
    })
  }
}
