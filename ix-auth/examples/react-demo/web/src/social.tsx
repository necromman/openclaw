/**
 * 소셜 로그인 — 화면 쪽 공통 조각.
 *
 * 로그인 화면(버튼)과 내 계정 화면(연결 관리)이 **같은 목록**을 본다.
 * 목록은 BFF 에 물어서 받는다 — 하드코딩하면 설정에서 끈 provider 의 버튼이 남아
 * "눌렀는데 안 되는" 상태가 된다.
 */
import { useEffect, useState } from 'react'

const LABEL: Record<string, string> = {
  MICROSOFT: 'Microsoft',
  KAKAO: '카카오',
  NAVER: '네이버',
}

export function providerLabel(provider: string): string {
  return LABEL[provider.toUpperCase()] ?? provider
}

/**
 * 켜져 있는 provider 목록.
 *
 * 하나도 없는 것이 <b>정상 상태</b>다 — 데모 기본값이 그렇고, 사내용 인스턴스도 대개
 * 소셜을 켜지 않는다. 그래서 실패해도 빈 목록으로 두고 화면은 그대로 뜬다.
 */
export function useSocialProviders() {
  const [providers, setProviders] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/social/providers', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setProviders(d?.providers ?? [])
      })
      .catch(() => {
        if (!cancelled) setProviders([])
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { providers, loaded }
}

/**
 * 로그인 화면의 소셜 버튼.
 *
 * <b>링크(&lt;a&gt;)로 둔다.</b> fetch 로 부르면 provider 로 나가는 리다이렉트가
 * CORS 에 막혀 아무 일도 일어나지 않는다 — 원인을 찾기 어려운 종류의 실패다.
 */
export function SocialLoginButtons() {
  const { providers, loaded } = useSocialProviders()

  // 설정된 provider 가 없으면 구분선도 그리지 않는다. 빈 자리를 남기면
  // "여기 뭔가 있어야 하는데 안 나온다" 로 읽힌다
  if (!loaded || providers.length === 0) return null

  return (
    <div className="social">
      <div className="social-sep"><span>또는</span></div>
      {providers.map((p) => (
        <a key={p} className="social-btn" href={`/api/social/${p.toLowerCase()}/start`}>
          {providerLabel(p)} 로 로그인
        </a>
      ))}
    </div>
  )
}
