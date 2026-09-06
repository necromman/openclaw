/**
 * 메일 링크가 도착하는 화면 — **앱이 만들어야 하는 부분**이다.
 *
 * IX-Auth 는 토큰 발급·검증·1회용 처리·세션 폐기를 전부 하지만, 화면은 만들지
 * 않는다(설계 불변식 1: headless). 링크도 IX-Auth 가 아니라 **앱** 주소를 가리킨다 —
 * IX-Auth 는 외부에 노출되지 않으므로 사용자의 브라우저가 열 수 없기 때문이다(불변식 4).
 *
 * 그래서 앱이 만들 것은 이 파일 하나 분량이다. 로직은 없고, 토큰을 받아 넘기는 것뿐이다.
 */
import { useEffect, useState } from 'react'

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = await res.json().catch(() => null)
  if (!res.ok) throw new Error(parsed?.message ?? `요청 실패 (${res.status})`)
  return parsed
}

/** 메일 링크의 ?token= 을 꺼낸다 */
function tokenFromUrl(): string {
  return new URLSearchParams(window.location.search).get('token') ?? ''
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main>
      <header>
        <h1>IX-Auth 데모</h1>
        <span className="sub">{title}</span>
      </header>
      <div className="panel" style={{ maxWidth: 460 }}>
        {children}
        <p className="note" style={{ marginTop: 16 }}>
          이 화면은 <strong>앱이 만든 것</strong>이다. IX-Auth 는 토큰과 메일만 책임지고
          화면은 만들지 않는다 — 링크가 앱 주소를 가리키는 이유이기도 하다.
        </p>
        <a href="/" className="ghost" style={{ display: 'inline-block', marginTop: 8 }}>
          ← 데모로
        </a>
      </div>
    </main>
  )
}

/** /reset-password?token=… */
export function ResetPasswordPage() {
  const [token] = useState(tokenFromUrl)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)

  if (!token) {
    return (
      <Shell title="비밀번호 재설정">
        <div className="msg err">링크에 토큰이 없다. 메일의 주소를 그대로 열어야 한다.</div>
      </Shell>
    )
  }

  return (
    <Shell title="비밀번호 재설정">
      {done ? (
        <div className="msg ok">
          비밀번호를 바꿨다. <strong>모든 기기에서 로그아웃</strong>됐으니 새 비밀번호로 다시
          로그인하면 된다.
        </div>
      ) : (
        <>
          <label>새 비밀번호</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <label>확인</label>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {msg && <div className="msg err">{msg}</div>}
          <button
            className="primary"
            style={{ marginTop: 12 }}
            onClick={async () => {
              if (pw !== pw2) return setMsg('두 입력이 다르다.')
              try {
                await post('/api/password/reset', { token, newPassword: pw })
                setDone(true)
              } catch (e) {
                setMsg((e as Error).message)
              }
            }}
          >
            변경
          </button>
          <p className="note" style={{ marginTop: 12 }}>
            정책에 맞지 않으면 거절되지만 <strong>링크는 죽지 않는다</strong> — 다시 입력하면
            된다. 성공하면 그때 토큰이 소모되고, 같은 링크는 다시 통하지 않는다.
          </p>
        </>
      )}
    </Shell>
  )
}

/** /accept-invite?token=… */
export function AcceptInvitePage() {
  const [token] = useState(tokenFromUrl)
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)

  if (!token) {
    return (
      <Shell title="초대 수락">
        <div className="msg err">링크에 토큰이 없다.</div>
      </Shell>
    )
  }

  return (
    <Shell title="초대 수락">
      {done ? (
        <div className="msg ok">
          계정이 활성화됐다. 이제 로그인할 수 있다 — 이메일도 확인된 것으로 처리된다
          (이 메일함을 쓸 수 있다는 것이 곧 주소 확인이므로).
        </div>
      ) : (
        <>
          <label>이름 (비우면 그대로 둔다)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <label>비밀번호</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          {msg && <div className="msg err">{msg}</div>}
          <button
            className="primary"
            style={{ marginTop: 12 }}
            onClick={async () => {
              try {
                await post('/api/invite/accept', { token, password: pw, name: name || null })
                setDone(true)
              } catch (e) {
                setMsg((e as Error).message)
              }
            }}
          >
            시작하기
          </button>
          <p className="note" style={{ marginTop: 12 }}>
            관리자가 비밀번호를 정해 알려 주는 대신 <strong>본인이 직접</strong> 정한다.
            그 전달 경로(메신저·구두)가 대개 가장 약한 고리이기 때문이다.
          </p>
        </>
      )}
    </Shell>
  )
}

/** /verify-email?token=… — 입력이 없다. 열리자마자 확인한다 */
export function VerifyEmailPage() {
  const [state, setState] = useState<'working' | 'ok' | 'fail'>('working')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const token = tokenFromUrl()
    if (!token) {
      setState('fail')
      setMsg('링크에 토큰이 없다.')
      return
    }
    post('/api/email/verify', { token })
      .then(() => setState('ok'))
      .catch((e: Error) => {
        setState('fail')
        setMsg(e.message)
      })
  }, [])

  return (
    <Shell title="이메일 확인">
      {state === 'working' && <div className="msg">확인하는 중…</div>}
      {state === 'ok' && (
        <div className="msg ok">
          확인됐다. 주소 변경 요청이었다면 <strong>이제부터</strong> 새 주소가 쓰인다 —
          확인 전까지는 기존 주소가 그대로였다.
        </div>
      )}
      {state === 'fail' && <div className="msg err">{msg}</div>}
    </Shell>
  )
}

/**
 * 라우터 없이 경로만 본다 — 어떤 라우터를 쓰든 상관없다는 뜻이다.
 * 실제 앱에서는 react-router 등의 라우트로 두면 된다.
 */
export function tokenPageFor(pathname: string) {
  switch (pathname) {
    case '/reset-password':
      return <ResetPasswordPage />
    case '/accept-invite':
      return <AcceptInvitePage />
    case '/verify-email':
      return <VerifyEmailPage />
    default:
      return null
  }
}
