# @ix-auth/client-react

IX-Auth React 클라이언트 — 로그인 상태와 권한 판정을 훅으로 제공한다.

> **이 패키지는 IX-Auth jar 를 직접 호출하지 않는다.** 브라우저는 앱 BFF 만 본다
> (설계 불변식 4). 서버 쪽은 [`@ix-auth/client-node`](../client-node) 가 담당한다.

---

## 설치

```bash
npm install @ix-auth/client-react
```

## 사용

```tsx
// main.tsx
import { IxAuthProvider } from '@ix-auth/client-react'

<IxAuthProvider basePath="/api">
  <App />
</IxAuthProvider>
```

```tsx
// App.tsx
import { useAuth, useCan, Protected } from '@ix-auth/client-react'

function App() {
  const { user, loading, login, logout, isAuthenticated } = useAuth()
  const canEdit = useCan('page:projects:edit')

  if (loading) return <Spinner />
  if (!isAuthenticated) return <LoginForm onSubmit={login} />

  return (
    <>
      <p>{user.name} ({user.roles.join(', ')})</p>
      {canEdit && <button>편집</button>}

      <Protected permission="page:admin.users:view" fallback={<NoAccess />}>
        <UserAdmin />
      </Protected>
    </>
  )
}
```

---

## API

| 훅 · 컴포넌트 | 하는 일 | 네트워크 |
|---|---|---|
| `useAuth()` | `user` · `loading` · `error` · `login` · `logout` · `reload` · `isAuthenticated` | 로그인·로그아웃 시에만 |
| `useCan(code)` | L1 권한 판정 | **없음** — 순수 계산 |
| `useResourcePermission(type, key, action)` | L2 인스턴스 권한 | 있음 |
| `<Protected permission fallback>` | 권한이 있을 때만 렌더 | 없음 |
| `<Authenticated fallback>` | 로그인했을 때만 렌더 | 없음 |
| `useIxAuth()` | 컨텍스트 전체 (`checkResource` 포함) | — |

`useCan` 이 네트워크를 타지 않는 이유: 유효 권한 목록을 로그인 시 한 번 받아 두었고, 와일드카드 매칭은 순수 계산이다. 화면 요소를 보일지 정하는 데 매번 왕복하면 UI 가 느려진다.

---

## 앱 BFF 가 제공해야 하는 엔드포인트

| 경로 | 응답 |
|------|------|
| `GET {basePath}/me` | `{ id, email, name, roles[], groups[], permissions[] }` |
| `POST {basePath}/login` | `{ email, password }` 를 받아 쿠키 발급 |
| `POST {basePath}/logout` | 세션 종료 |
| `GET {basePath}/resource-check?type=&key=&action=` | `{ allowed, reason, matchedKey, grantId }` |

이름을 바꾸려면 `endpoints` prop 으로 넘긴다. 구현은 `@ix-auth/client-node` 를 쓰면 몇 줄이다 — [예제](../../examples/react-demo) 참조.

> `resource-check` 를 구현할 때 **사용자 ID 를 클라이언트에서 받지 않는다.** 반드시 토큰에서
> 꺼낸다 — 그러지 않으면 남의 권한을 조회할 수 있다.

---

## 주의

1. **화면을 가리는 것은 UX 이지 보안이 아니다.** `<Protected>` 로 버튼을 숨겨도 API 를 직접 부르면 그만이다. 실제 차단은 서버가 한다
2. **권한 변경은 즉시 반영되지 않는다.** 토큰이 새로 발급될 때 전파되므로 최대 액세스 토큰 수명(기본 15분)만큼 늦다. 즉시 반영이 필요하면 관리 화면에서 해당 사용자의 세션을 종료한다
3. 권한 코드 매칭은 서버(`PermissionMatcher.java`)·`@ix-auth/client-node` 와 **같은 규칙**이어야 한다. 계약(`docs/contract/authz.md` §2)을 바꿀 때 세 곳을 함께 고친다
