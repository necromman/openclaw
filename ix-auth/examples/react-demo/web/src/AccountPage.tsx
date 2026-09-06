/**
 * "내 계정" 화면 — **앱이 만들어야 하는 부분**이다.
 *
 * IX-Auth 는 비밀번호 정책·메일 토큰·세션 폐기·소셜 연결을 전부 처리하지만 화면은
 * 만들지 않는다(설계 불변식 1: headless). 그리고 외부에 노출되지 않으므로(불변식 4)
 * 브라우저가 IX-Auth 를 직접 부를 수도 없다 — 이 파일의 모든 호출은 **앱 BFF** 로 간다.
 *
 * 로직은 없다. 입력을 받아 BFF 로 넘기고, 결과를 사람이 읽을 수 있는 말로 바꾸는 것뿐이다.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@ix-auth/client-react'
import { providerLabel, useSocialProviders } from './social'

type SessionInfo = {
  id: string
  issuedAt: string
  lastUsedAt: string | null
  expiresAt: string
  ip: string | null
  userAgent: string | null
  current: boolean
}

type SocialLink = {
  provider: string
  email: string | null
  displayName: string | null
  linkedAt: string | null
  lastLoginAt: string | null
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  // BFF 가 정해 준 문구만 쓴다. jar 의 원문에는 계정 존재 여부가 섞여 있다
  if (!res.ok) throw new Error(body?.message ?? `요청 실패 (${res.status})`)
  return body
}

const postJson = (path: string, body: unknown) =>
  api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/**
 * 소셜 연결에서 돌아왔을 때 주소에 붙는 결과를 읽는다.
 *
 * 읽고 나서 주소를 지우는 이유 — 남겨 두면 새로고침할 때마다 지난 결과가 다시 뜬다.
 */
function useRedirectResult(): string | null {
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const linked = q.get('linked')
    const error = q.get('error')

    if (linked) setBanner(`${providerLabel(linked)} 계정을 연결했다.`)
    else if (error === 'link-taken') setBanner('그 소셜 계정은 다른 계정에 연결돼 있다.')
    else if (error === 'link') setBanner('연결하지 못했다. 다시 시도해 보라.')
    else return  // 로그인 화면이 읽어야 하는 사유는 남겨 둔다

    q.delete('linked')
    q.delete('error')
    const rest = q.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [])

  return banner
}

export default function AccountPage() {
  const { user, reload } = useAuth()
  const banner = useRedirectResult()

  return (
    <>
      {banner && <div className="msg">{banner}</div>}
      <ChangePassword onSignedOut={reload} />
      <ChangeEmail currentEmail={user?.email ?? ''} />
      <SocialAccounts />
      <MySessions />
    </>
  )
}

// ───────────────────────── 비밀번호 변경 ─────────────────────────

function ChangePassword({ onSignedOut }: { onSignedOut: () => Promise<void> }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    // 두 입력이 다른 것은 서버까지 갈 일이 아니다 — 왕복 한 번이 아깝고, 오타는 흔하다
    if (next !== confirm) return setMsg('새 비밀번호 두 입력이 다르다.')
    setBusy(true)
    setMsg('')
    try {
      await postJson('/api/password/change', { currentPassword: current, newPassword: next })
      setDone(true)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
      setCurrent('')
      setNext('')
      setConfirm('')
    }
  }

  return (
    <div className="panel">
      <h2>비밀번호 변경</h2>
      {done ? (
        <>
          <div className="msg ok">
            비밀번호를 바꿨다. <strong>모든 기기에서 로그아웃</strong>됐으니 새 비밀번호로 다시
            로그인하면 된다.
          </div>
          <button className="ghost" onClick={() => void onSignedOut()}>
            로그인 화면으로
          </button>
        </>
      ) : (
        <>
          <p className="note" style={{ marginTop: 0 }}>
            바꾸면 <strong>이 기기를 포함한 모든 세션이 끊긴다.</strong> 비밀번호를 바꾸는 이유는
            대개 계정을 빼앗겼기 때문이고, 세션을 남겨 두면 빼앗은 쪽이 그대로 남는다.
          </p>
          <label>현재 비밀번호</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
          <label>새 비밀번호</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
          <label>새 비밀번호 확인</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {msg && <div className="msg err">{msg}</div>}
          <div style={{ marginTop: 14 }}>
            <button disabled={busy || !current || !next} onClick={() => void submit()}>
              {busy ? '변경 중…' : '비밀번호 변경'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ───────────────────────── 이메일 변경 ─────────────────────────

function ChangeEmail({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setMsg('')
    try {
      await postJson('/api/email/change', { newEmail, currentPassword: password })
      setSent(true)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <div className="panel">
      <h2>이메일 변경</h2>
      <p className="note" style={{ marginTop: 0 }}>
        지금 주소는 <code>{currentEmail || '—'}</code> 다. 새 주소로 <strong>확인 메일</strong>이
        가고, 그 링크(<code>/verify-email</code>)를 눌러야 바뀐다 —{' '}
        <strong>그 전까지는 지금 주소가 그대로 쓰인다.</strong> 쓸 수 없는 주소로 바꿔 놓고
        계정을 잃는 일이 없게 한 것이다.
      </p>
      {sent ? (
        <div className="msg ok">
          새 주소로 확인 메일을 보냈다. 데모는 <code>transport=LOG</code> 라 jar 로그에 링크가
          찍힌다. 링크를 열면 그때 주소가 바뀐다.
        </div>
      ) : (
        <>
          <label>새 이메일</label>
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            autoComplete="email"
            placeholder="new@example.com"
          />
          <label>현재 비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {msg && <div className="msg err">{msg}</div>}
          <div style={{ marginTop: 14 }}>
            <button disabled={busy || !newEmail || !password} onClick={() => void submit()}>
              {busy ? '요청 중…' : '확인 메일 보내기'}
            </button>
          </div>
          <p className="note">
            비밀번호를 함께 받는 이유 — 자리를 비운 사이 주소만 바꿔치기하면 그 다음
            "비밀번호 찾기" 한 번으로 계정을 통째로 가져갈 수 있다.
          </p>
        </>
      )}
    </div>
  )
}

// ─────────────────────── 연결된 소셜 계정 ───────────────────────

function SocialAccounts() {
  const { providers, loaded } = useSocialProviders()
  const [links, setLinks] = useState<SocialLink[] | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await api('/api/social/links')
      setLinks(r?.items ?? [])
    } catch {
      // 소셜을 안 쓰는 인스턴스에서도 이 화면은 떠야 한다
      setLinks([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function unlink(provider: string) {
    setMsg('')
    try {
      await api(`/api/social/${provider.toLowerCase()}/link`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const linkedOf = (p: string) => links?.find((l) => l.provider.toUpperCase() === p.toUpperCase())

  return (
    <div className="panel">
      <h2>연결된 소셜 계정</h2>

      {!loaded ? (
        <div className="msg">확인 중…</div>
      ) : providers.length === 0 ? (
        <p className="note" style={{ marginTop: 0 }}>
          <strong>설정된 소셜 로그인이 없다.</strong> 데모 기본값이 그렇다 — 사내용 인스턴스는
          대개 켜지 않는다. <code>ixauth.social.*</code> 에 provider 를 켜고{' '}
          <code>client-id</code> 를 넣으면 여기에 나타난다.
        </p>
      ) : (
        <>
          <div className="links">
            {providers.map((p) => {
              const linked = linkedOf(p)
              return (
                <div className="linkrow" key={p}>
                  <div className="grow">
                    <strong>{providerLabel(p)}</strong>
                    <div className="note" style={{ margin: 0 }}>
                      {linked
                        ? `${linked.email ?? linked.displayName ?? '연결됨'}`
                        : '연결 안 됨'}
                    </div>
                  </div>
                  {linked ? (
                    <button className="ghost" onClick={() => void unlink(p)}>
                      해제
                    </button>
                  ) : (
                    // 링크로 둔다 — fetch 로 부르면 provider 로 나가는 리다이렉트가 막힌다
                    <a className="social-btn compact" href={`/api/social/${p.toLowerCase()}/link/start`}>
                      연결
                    </a>
                  )}
                </div>
              )
            })}
          </div>
          {msg && <div className="msg err">{msg}</div>}
        </>
      )}

      <p className="note">
        로그인한 상태에서 연결하는 것이 <strong>가장 안전한 경로다.</strong> 본인 확인이 이미
        끝났으므로 provider 의 이메일 검증 신호에 기댈 필요가 없다 — 네이버처럼 검증 여부를 주지
        않는 provider 도 이 경로로는 붙는다.
        <br />
        <strong>마지막 로그인 수단은 해제되지 않는다.</strong> 비밀번호가 없는 계정에서 마지막
        연결을 끊으면 그 계정으로 들어올 방법이 사라지기 때문이다. 그때는 비밀번호 찾기로
        비밀번호를 먼저 만든다.
      </p>
    </div>
  )
}

// ───────────────────────── 내 기기(세션) ─────────────────────────

function MySessions() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setMsg('')
    try {
      const r = await api('/api/sessions')
      setSessions(r?.items ?? [])
    } catch (e) {
      setMsg((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function revoke(id: string) {
    try {
      await api(`/api/sessions/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div className="panel">
      <h2>내 기기</h2>
      <div className="row">
        <button className="ghost" onClick={() => void load()}>다시 읽기</button>
      </div>
      {msg && <div className="msg err">{msg}</div>}
      {sessions && sessions.length > 0 && (
        <table className="sessions">
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <code>{s.id.slice(0, 8)}</code>
                  {s.current && <span className="badge">이 기기</span>}
                </td>
                <td>{s.ip ?? '-'}</td>
                <td className="ua">{(s.userAgent ?? '-').slice(0, 40)}</td>
                <td>
                  {!s.current && (
                    <button className="ghost" onClick={() => void revoke(s.id)}>끊기</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="note">
        남의 세션 ID 를 넣어도 끊기지 않는다 — 소유자를 대조한다. 이 확인이 없으면 세션 ID
        하나로 아무나 로그아웃시킬 수 있다. 그래서 <em>없는 세션</em>과 <em>남의 세션</em>의
        응답도 같다.
      </p>
    </div>
  )
}
