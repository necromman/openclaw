/**
 * 권한 코드 매칭 — 계약 docs/contract/authz.md §2.
 *
 * 서버의 `PermissionMatcher.java`, `@ix-auth/client-node` 의 `permissions.js` 와
 * <b>같은 규칙</b>이어야 한다. 계약을 바꿀 때 세 곳을 함께 고친다.
 */

const SEGMENT = /[./]/
const ANY = '*'
const ANY_DEEP = '**'

export function matches(pattern: string, required: string): boolean {
  const p = String(pattern ?? '').split(':')
  const r = String(required ?? '').split(':')
  if (p.length !== 3 || r.length !== 3) return false
  for (let i = 0; i < 3; i++) {
    if (!partMatches(p[i], r[i])) return false
  }
  return true
}

function partMatches(pattern: string, value: string): boolean {
  if (pattern === ANY || pattern === ANY_DEEP) return true

  const p = pattern.split(SEGMENT)
  const v = value.split(SEGMENT)

  for (let i = 0; i < p.length; i++) {
    if (p[i] === ANY_DEEP) return v.length > i
    if (i >= v.length) return false
    if (p[i] !== ANY && p[i] !== v[i]) return false
  }
  // 패턴을 다 썼는데 값이 남으면 불일치 — page:admin.* 는 page:admin.users.detail 을 덮지 않는다
  return p.length === v.length
}

export function anyMatches(granted: string[] | undefined, required: string): boolean {
  if (!granted || granted.length === 0) return false
  return granted.some((g) => matches(g, required))
}
