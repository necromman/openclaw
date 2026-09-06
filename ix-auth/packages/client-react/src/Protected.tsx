import type { ReactNode } from 'react'
import { useIxAuth } from './IxAuthProvider'

/**
 * 권한이 있을 때만 자식을 렌더한다.
 *
 * ```tsx
 * <Protected permission="page:admin.users:view" fallback={<NoAccess />}>
 *   <UserAdmin />
 * </Protected>
 * ```
 *
 * <p><b>화면을 가리는 것은 UX 이지 보안이 아니다.</b> 실제 차단은 서버에서 해야 한다 —
 * 버튼을 숨겨도 API 를 직접 부르면 그만이다.</p>
 */
export function Protected({
  permission,
  children,
  fallback = null,
  loadingFallback = null,
}: {
  permission: string
  children: ReactNode
  fallback?: ReactNode
  loadingFallback?: ReactNode
}) {
  const { can, loading, user } = useIxAuth()

  if (loading) return <>{loadingFallback}</>
  if (!user) return <>{fallback}</>
  return can(permission) ? <>{children}</> : <>{fallback}</>
}

/** 로그인해야 보이는 영역 */
export function Authenticated({
  children,
  fallback = null,
  loadingFallback = null,
}: {
  children: ReactNode
  fallback?: ReactNode
  loadingFallback?: ReactNode
}) {
  const { user, loading } = useIxAuth()
  if (loading) return <>{loadingFallback}</>
  return user ? <>{children}</> : <>{fallback}</>
}
