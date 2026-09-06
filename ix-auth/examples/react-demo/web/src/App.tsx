import { useCallback, useEffect, useState } from 'react'
import {
  useAuth,
  useCan,
  useIxAuth,
  Protected,
  type ResourceVerdict,
} from '@ix-auth/client-react'
import AccountPage from './AccountPage'
import { SocialLoginButtons } from './social'

/** BFF 가 계측용으로 덧붙여 주는 필드 — 패키지 표준에는 없다 */
type DemoMetrics = {
  verifiedLocally?: boolean
  localVerifyCount?: number
  permissionMapVersion?: number
  tokenPv?: number
  expiresAt?: string
}

async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const parsed = await res.json().catch(() => null)
  if (!res.ok) throw new Error(parsed?.message ?? `요청 실패 (${res.status})`)
  return parsed
}

async function api(path: string) {
  const res = await fetch(path, { credentials: 'include' })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.message ?? `요청 실패 (${res.status})`)
  return body
}

/**
 * 소셜 로그인이 실패해 돌아왔을 때 주소에 붙는 사유.
 *
 * BFF 가 셋 이상의 원인을 두 가지로만 뭉쳐 보낸다 — 더 자세히 알려 주면
 * "그 주소로 가입된 계정이 있다" 가 새어 나간다. 원인은 jar 로그에 남는다.
 */
const LOGIN_ERROR: Record<string, string> = {
  social: '소셜 로그인에 실패했다. 다시 시도해 보라.',
  'no-account': '연결된 계정이 없다. 관리자에게 문의하라.',
  'login-required': '로그인이 필요한 요청이었다.',
}

function useLoginError(): string | null {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const text = LOGIN_ERROR[q.get('error') ?? '']
    // 모르는 사유는 건드리지 않는다 — 계정 화면이 자기 것(link…)을 읽어야 하는데
    // 여기서 지워 버리면 그쪽 결과가 사라진다
    if (!text) return

    setMsg(text)
    // 읽었으면 지운다. 남겨 두면 새로고침할 때마다 지난 오류가 다시 뜬다
    q.delete('error')
    const rest = q.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [])

  return msg
}

export default function App() {
  const { user, loading, error, login, logout, isAuthenticated } = useAuth()
  const { checkResource } = useIxAuth()

  // BFF 가 소셜 연결 결과를 `?tab=account` 로 돌려보낸다 — 그 화면으로 열어 준다
  const [tab, setTab] = useState<'demo' | 'account'>(
    () => (new URLSearchParams(window.location.search).get('tab') === 'account' ? 'account' : 'demo'),
  )
  const loginError = useLoginError()

  const [email, setEmail] = useState('admin@demo.local')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [jarUp, setJarUp] = useState<boolean | null>(null)

  const [probe, setProbe] = useState('page:reports:view')
  const [apiResult, setApiResult] = useState('')
  const [filePath, setFilePath] = useState('/contracts/2026/a.pdf')
  const [fileVerdict, setFileVerdict] = useState<ResourceVerdict | null>(null)
  const [fileResult, setFileResult] = useState('')
  const [myFiles, setMyFiles] = useState<string[]>([])

  // 비밀번호 찾기 — 로그인 화면에 둔다. 로그인 못 하는 사람이 쓰는 기능이다
  const [forgotEmail, setForgotEmail] = useState('admin@demo.local')
  const [forgotMsg, setForgotMsg] = useState('')

  // 훅으로 판정 — 로컬 계산이라 렌더 중 자유롭게 쓴다
  const canProbe = useCan(probe)
  const metrics = user as (typeof user & DemoMetrics) | null

  const checkJar = useCallback(async () => {
    try {
      const r = await api('/api/ixauth-status')
      setJarUp(Boolean(r?.reachable))
    } catch {
      setJarUp(false)
    }
  }, [])

  useEffect(() => {
    void checkJar()
    const t = setInterval(checkJar, 5000)
    return () => clearInterval(t)
  }, [checkJar])

  async function onLogin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await login(email, password)
      setPassword('')
    } catch {
      // 오류 메시지는 컨텍스트가 들고 있다
    } finally {
      setBusy(false)
    }
  }

  async function checkFile() {
    setFileResult('')
    try {
      setFileVerdict(await checkResource('file', filePath, 'download'))
    } catch (err) {
      setFileVerdict(null)
      setFileResult((err as Error).message)
    }
  }

  async function downloadFile() {
    setFileVerdict(null)
    try {
      setFileResult(`200 · ${JSON.stringify(await api(`/api/files${filePath}`))}`)
    } catch (err) {
      setFileResult(`거부됨 · ${(err as Error).message}`)
    }
  }

  async function callProtected(path: string) {
    try {
      setApiResult(`200 · ${JSON.stringify(await api(path))}`)
    } catch (err) {
      setApiResult(`거부됨 · ${(err as Error).message}`)
    }
  }

  return (
    <main>
      <h1>IX-Auth 로그인 데모</h1>
      <p className="sub">
        React(Vite) + Node BFF. 화면은 <code>@ix-auth/client-react</code>, 서버는{' '}
        <code>@ix-auth/client-node</code> 를 쓴다. 브라우저는 IX-Auth jar 를 직접 호출하지 않는다.
      </p>

      <div className="panel">
        <h2>IX-Auth jar 상태</h2>
        <span className={`badge ${jarUp ? 'on' : 'off'}`}>
          {jarUp === null ? '확인 중' : jarUp ? '기동 중' : '응답 없음'}
        </span>
        <p className="note">
          <strong>jar 를 꺼도 로그인 상태는 유지된다.</strong> 앱이 JWKS 공개키로 토큰을 스스로
          검증하기 때문이다(설계 불변식 2). 꺼진 동안 안 되는 것은 <em>새 로그인</em>과{' '}
          <em>파일 권한 조회</em>뿐이다.
        </p>
      </div>

      {loading ? (
        <div className="panel">확인 중…</div>
      ) : !isAuthenticated ? (
        <>
          <form className="panel" onSubmit={onLogin}>
            <h2>로그인</h2>
            {loginError && <div className="msg err">{loginError}</div>}
            {error && <div className="msg err">{error}</div>}
            <label>이메일</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            <label>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <div style={{ marginTop: 16 }}>
              <button disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
            </div>

            {/* 켜져 있는 provider 만 그린다. 하나도 없으면 아무것도 나오지 않는다 */}
            <SocialLoginButtons />

            <p className="note">
              없는 계정과 틀린 비밀번호는 <strong>같은 응답</strong>을 준다 — 계정 존재 여부가
              새어나가지 않게 한 것이다. 5회 틀리면 잠긴다.
            </p>
          </form>

          <div className="panel">
            <h2>비밀번호 찾기</h2>
            <div className="row">
              <input
                className="grow"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="이메일"
              />
              <button
                className="ghost"
                onClick={async () => {
                  try {
                    await post('/api/password/forgot', { email: forgotEmail })
                    setForgotMsg(
                      '요청됨 — 메일이 발송되었다면 발송되었다. ' +
                        '데모는 transport=LOG 이므로 jar 로그에 링크가 찍힌다.',
                    )
                  } catch (e) {
                    setForgotMsg((e as Error).message)
                  }
                }}
              >
                재설정 메일 요청
              </button>
            </div>
            {forgotMsg && <div className="msg">{forgotMsg}</div>}
            <p className="note">
              <strong>없는 주소를 넣어도 응답이 같다.</strong> 다르게 답하면 이 화면이
              가입자 명부를 조회하는 도구가 된다. 링크는 <em>앱</em> 주소를 가리킨다 —
              jar 는 외부에 노출되지 않기 때문이다.
            </p>
          </div>
        </>
      ) : (
        <>
          {/* 라우터 없이 탭으로 나눈다 — 실제 앱에서는 /settings/account 같은 라우트로 둔다 */}
          <nav className="tabs">
            <button
              className={`tab${tab === 'demo' ? ' on' : ''}`}
              onClick={() => setTab('demo')}
            >
              데모
            </button>
            <button
              className={`tab${tab === 'account' ? ' on' : ''}`}
              onClick={() => setTab('account')}
            >
              내 계정
            </button>
          </nav>

          <div className="panel">
            <h2>로그인됨</h2>
            <dl>
              <dt>이름</dt><dd>{user!.name}</dd>
              <dt>이메일</dt><dd>{user!.email}</dd>
              <dt>역할</dt>
              <dd>{user!.roles.map((r) => <span key={r} className="badge">{r}</span>)}</dd>
              <dt>그룹</dt>
              <dd>{user!.groups.length
                ? user!.groups.map((g) => <span key={g} className="badge">{g}</span>)
                : '—'}</dd>
              <dt>권한</dt>
              <dd>{user!.permissions.length
                ? user!.permissions.map((p) => <span key={p} className="badge"><code>{p}</code></span>)
                : '—'}</dd>
              {metrics?.expiresAt && (
                <>
                  <dt>토큰 만료</dt>
                  <dd>{new Date(metrics.expiresAt).toLocaleString('ko-KR')}</dd>
                </>
              )}
            </dl>
            <div style={{ marginTop: 16 }}>
              <button className="ghost" onClick={() => void logout()}>로그아웃</button>
            </div>
          </div>

          {/* 내 계정 화면은 통째로 별도 파일이다 — 앱이 그대로 복사해 쓰라고 떼어 두었다 */}
          {tab === 'account' ? <AccountPage /> : <>

          <div className="panel">
            <h2>로컬 검증 계측</h2>
            <div className="kpi">
              <div><strong>{metrics?.localVerifyCount ?? 0}</strong>BFF 로컬 검증 횟수</div>
              <div><strong>{metrics?.verifiedLocally ? 'O' : 'X'}</strong>jar 미경유</div>
              <div><strong>{metrics?.permissionMapVersion ?? '-'}</strong>캐시된 맵 버전</div>
              <div><strong>{metrics?.tokenPv ?? '-'}</strong>토큰의 pv</div>
            </div>
            <p className="note">
              이 숫자만큼 요청을 처리하는 동안 <strong>jar 를 한 번도 부르지 않았다.</strong>{' '}
              토큰의 <code>pv</code> 가 캐시된 맵 버전보다 커지면 그때만 맵을 다시 받는다 — 폴링이 없다.
            </p>
          </div>

          <div className="panel">
            <h2>권한 판정 실험 (L1 — 로컬)</h2>
            <div className="row">
              <div className="grow">
                <label>권한 코드</label>
                <input value={probe} onChange={(e) => setProbe(e.target.value)} />
              </div>
            </div>
            <div className={`msg ${canProbe ? 'ok' : 'err'}`}>
              <code>{probe}</code> → {canProbe ? '허용' : '거부'}
            </div>
            <p className="note">
              입력하는 즉시 판정된다 — <code>useCan()</code> 은 서버에 묻지 않고 계산만 한다.
              와일드카드를 시험해 보라: <code>ixauth:*:*</code> 를 가진 ADMIN 은{' '}
              <code>ixauth:users:read</code> 도 통과한다.
            </p>
          </div>

          <div className="panel">
            <h2>파일 권한 (L2 — 경로 상속)</h2>
            <div className="row">
              <div className="grow">
                <label>파일 경로</label>
                <input value={filePath} onChange={(e) => setFilePath(e.target.value)} />
              </div>
              <button className="ghost" onClick={checkFile}>판정</button>
              <button className="ghost" onClick={downloadFile}>다운로드 시도</button>
            </div>
            {fileVerdict && (
              <div className={`msg ${fileVerdict.allowed ? 'ok' : 'err'}`}>
                {fileVerdict.allowed ? '허용' : '거부'} · 근거 <code>{fileVerdict.reason}</code>
                {fileVerdict.matchedKey && <> · 매칭 <code>{fileVerdict.matchedKey}</code></>}
              </div>
            )}
            {fileResult && <div className="msg">{fileResult}</div>}
            <div style={{ marginTop: 12 }}>
              <button
                className="ghost"
                onClick={async () => setMyFiles((await api('/api/my-files'))?.keys ?? [])}
              >
                접근 가능한 경로 보기
              </button>
              {myFiles.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {myFiles.map((k) => <span key={k} className="badge"><code>{k}</code></span>)}
                </div>
              )}
            </div>
            <p className="note">
              <code>/contracts/</code> 권한이 <strong>하위로 상속</strong>된다. 반면{' '}
              <code>/contracts/secret/</code> 에는 DENY 가 걸려 그 아래는 상속을 무시하고 막힌다.
              형제 경로는 영향을 받지 않는다 — 조상만 보기 때문이다.
              <br />
              시험: <code>/contracts/2026/a.pdf</code>(허용) ·{' '}
              <code>/contracts/secret/x.pdf</code>(거부) · <code>/nowhere/z.pdf</code>(권한 없음)
            </p>
          </div>

          <div className="panel">
            <h2>보호된 API</h2>
            <div className="row">
              <button className="ghost" onClick={() => callProtected('/api/admin-area')}>
                ixauth:users:read 필요
              </button>
              <button className="ghost" onClick={() => callProtected('/api/reports')}>
                page:reports:view 필요
              </button>
            </div>
            {apiResult && <div className="msg">{apiResult}</div>}

            <div style={{ marginTop: 14 }}>
              <Protected
                permission="page:reports:view"
                fallback={
                  <div className="msg err">
                    <code>&lt;Protected&gt;</code> 가 이 영역을 가렸다 —{' '}
                    <code>page:reports:view</code> 가 없다
                  </div>
                }
              >
                <div className="msg ok">
                  <code>&lt;Protected&gt;</code> 통과 — 권한이 있어야 보이는 영역
                </div>
              </Protected>
            </div>

            <p className="note">
              거부돼도 응답은 <strong>무엇이 없어서 막혔는지 알려주지 않는다.</strong>{' '}
              그리고 화면을 가리는 것은 UX 이지 보안이 아니다 — 실제 차단은 서버가 한다.
            </p>
          </div>

          </>}
          {/* ↑ '데모' 탭의 패널들 */}
        </>
      )}
    </main>
  )
}
