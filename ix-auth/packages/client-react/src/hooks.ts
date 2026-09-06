import { useEffect, useState } from 'react'
import { useIxAuth } from './IxAuthProvider'
import type { ResourceVerdict } from './types'

/** 로그인 상태와 사용자 정보 */
export function useAuth() {
  const { user, loading, error, login, logout, reload } = useIxAuth()
  return { user, loading, error, login, logout, reload, isAuthenticated: user !== null }
}

/**
 * L1 권한 판정 — 로컬 계산이라 렌더 중 자유롭게 써도 된다.
 *
 * ```tsx
 * const canEdit = useCan('page:projects:edit')
 * {canEdit && <button>편집</button>}
 * ```
 */
export function useCan(permissionCode: string): boolean {
  const { can } = useIxAuth()
  return can(permissionCode)
}

/**
 * L2 인스턴스 권한 — 서버에 물어보므로 비동기다.
 *
 * <p>목록에서 항목마다 호출하지 않는다. 그럴 땐 앱 BFF 에 batch 엔드포인트를 두고
 * 한 번에 판정한다 (계약 authz.md §6).</p>
 */
export function useResourcePermission(
  resourceType: string,
  resourceKey: string | null,
  action: string,
) {
  const { checkResource } = useIxAuth()
  const [verdict, setVerdict] = useState<ResourceVerdict | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!resourceKey) {
      setVerdict(null)
      return
    }
    let cancelled = false
    setLoading(true)
    checkResource(resourceType, resourceKey, action)
      .then((v) => {
        if (!cancelled) setVerdict(v)
      })
      .catch(() => {
        if (!cancelled) setVerdict({ allowed: false, reason: 'ERROR', matchedKey: null, grantId: null })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [checkResource, resourceType, resourceKey, action])

  return { verdict, loading, allowed: verdict?.allowed ?? false }
}
