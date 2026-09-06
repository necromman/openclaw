import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { anyMatches } from './permissions'
import type {
  IxAuthContextValue,
  IxAuthEndpoints,
  IxAuthUser,
  ResourceVerdict,
} from './types'

const Ctx = createContext<IxAuthContextValue | null>(null)

const DEFAULT_ENDPOINTS: IxAuthEndpoints = {
  me: '/me',
  login: '/login',
  logout: '/logout',
  check: '/resource-check',
}

async function request(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'include', ...init })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.message ?? body?.error?.message ?? `요청 실패 (${res.status})`)
  }
  return body
}

export function IxAuthProvider({
  basePath = '/api',
  endpoints,
  children,
}: {
  basePath?: string
  endpoints?: Partial<IxAuthEndpoints>
  children: ReactNode
}) {
  const ep = useMemo(() => ({ ...DEFAULT_ENDPOINTS, ...endpoints }), [endpoints])
  const [user, setUser] = useState<IxAuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setUser(await request(basePath + ep.me))
      setError(null)
    } catch {
      // 미로그인은 오류가 아니다 — 로그인 화면을 보여주면 된다
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [basePath, ep.me])

  useEffect(() => {
    void reload()
  }, [reload])

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null)
      try {
        await request(basePath + ep.login, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        await reload()
      } catch (e) {
        setError((e as Error).message)
        throw e
      }
    },
    [basePath, ep.login, reload],
  )

  const logout = useCallback(async () => {
    try {
      await request(basePath + ep.logout, { method: 'POST' })
    } finally {
      setUser(null)
    }
  }, [basePath, ep.logout])

  /**
   * L1 권한 판정 — 서버에 묻지 않는다.
   *
   * 유효 권한 목록은 로그인 시 한 번 받아 두었고, 매칭은 순수 계산이다.
   * 화면 요소를 보일지 말지 정하는 데 매번 왕복하면 UI 가 느려진다.
   */
  const can = useCallback(
    (permissionCode: string) => anyMatches(user?.permissions, permissionCode),
    [user],
  )

  /** L2 인스턴스 권한 — 파일·문서처럼 건별로 갈리는 것만 */
  const checkResource = useCallback(
    async (resourceType: string, resourceKey: string, action: string): Promise<ResourceVerdict> =>
      request(
        `${basePath}${ep.check}?type=${encodeURIComponent(resourceType)}`
          + `&key=${encodeURIComponent(resourceKey)}&action=${encodeURIComponent(action)}`,
      ),
    [basePath, ep.check],
  )

  const value = useMemo<IxAuthContextValue>(
    () => ({ user, loading, error, login, logout, reload, can, checkResource }),
    [user, loading, error, login, logout, reload, can, checkResource],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useIxAuth(): IxAuthContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useIxAuth 는 <IxAuthProvider> 안에서만 쓸 수 있습니다.')
  }
  return ctx
}
