export type IxAuthUser = {
  id: string
  email: string
  name: string
  roles: string[]
  groups: string[]
  /** 유효 권한 코드 — 앱이 화면 노출 판단에 쓴다 */
  permissions: string[]
  [key: string]: unknown
}

export type IxAuthState = {
  user: IxAuthUser | null
  loading: boolean
  error: string | null
}

export type IxAuthContextValue = IxAuthState & {
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  reload: () => Promise<void>
  /** L1 권한 판정 — 로컬 계산. 네트워크를 타지 않는다 */
  can: (permissionCode: string) => boolean
  /** L2 인스턴스 권한 — BFF 를 거쳐 IX-Auth 에 물어본다 */
  checkResource: (resourceType: string, resourceKey: string, action: string) => Promise<ResourceVerdict>
}

export type ResourceVerdict = {
  allowed: boolean
  reason: string
  matchedKey: string | null
  grantId: number | null
}

export type IxAuthProviderProps = {
  /**
   * 앱 BFF 의 API 경로. 기본 `/api`.
   *
   * <b>IX-Auth jar 주소가 아니다.</b> 브라우저는 jar 를 직접 호출하지 않는다 —
   * 앱 서버가 중계한다 (설계 불변식 4).
   */
  basePath?: string
  /** 엔드포인트 이름을 앱에 맞게 바꿀 때 */
  endpoints?: Partial<IxAuthEndpoints>
  children: React.ReactNode
}

export type IxAuthEndpoints = {
  me: string
  login: string
  logout: string
  check: string
}
