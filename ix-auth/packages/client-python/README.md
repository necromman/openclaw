# ix-auth-client (Python)

FastAPI·Flask·Django 앱이 IX-Auth 에 붙는 클라이언트.

**이 패키지가 하는 일은 네 가지뿐이다.**

| | 하는 일 | 네트워크 |
|---|---------|---------|
| 1 | 로그인·갱신·로그아웃 중계 | IX-Auth 호출 |
| 2 | **토큰 검증** — JWKS 공개키로 앱 안에서 | **없음** |
| 3 | **L1 권한 판정** — permission-map 캐시로 앱 안에서 | **없음** |
| 4 | L2 인스턴스 권한(파일·문서) 조회 | IX-Auth 호출 |

②③이 로컬인 것이 핵심이다 (설계 불변식 2). IX-Auth 가 잠깐 내려가도 **이미 로그인한 사용자는 계속 쓴다** — 새 로그인만 막힌다.

## 설치

```bash
pip install -e packages/client-python        # 개발 중
# 또는 사내 인덱스 게시 후
pip install ix-auth-client
```

Python 3.11+ / `httpx` / `pyjwt[crypto]`. FastAPI 헬퍼를 쓰려면 `pip install "ix-auth-client[fastapi]"`.

## 5분 연동 (FastAPI)

```python
from fastapi import Depends, FastAPI, Request, Response
from typing import Annotated

from ix_auth_client import IxAuthClient, client_meta_from
from ix_auth_client.fastapi import ACCESS_COOKIE, REFRESH_COOKIE, build_dependencies

ixauth = IxAuthClient(
    base_url="http://127.0.0.1:9100",     # 또는 IXAUTH_BASE_URL
    service_key="...",                    # 또는 IXAUTH_SERVICE_KEY
    issuer="ix-auth",                     # 또는 IXAUTH_JWT_ISSUER
)
ixauth.load_permission_map()              # 기동 시 1회

current_user, require_permission = build_dependencies(ixauth)
app = FastAPI()


@app.post("/api/login")
async def login(body: dict, request: Request, response: Response):
    # client_meta_from 이 {"ip": ..., "user_agent": ...} 를 준다.
    # request.client.host 를 쓰지 않는다 (아래 "실방문자 IP")
    r = ixauth.login(body["email"], body["password"], **client_meta_from(request.headers))
    # 토큰은 반드시 HttpOnly 쿠키로 — 브라우저 JS 에 넘기지 않는다
    response.set_cookie(ACCESS_COOKIE, r["accessToken"], httponly=True, samesite="lax")
    response.set_cookie(REFRESH_COOKIE, r["refreshToken"], httponly=True, samesite="lax")
    return {"user": r["user"]}


@app.post("/api/logout")
async def logout(request: Request, response: Response):
    # 갱신·로그아웃도 감사에 남는다. 세 호출 전부에 meta 를 넘긴다
    ixauth.logout(request.cookies.get(REFRESH_COOKIE), **client_meta_from(request.headers))
    response.delete_cookie(ACCESS_COOKIE)
    response.delete_cookie(REFRESH_COOKIE)
    return {"ok": True}


@app.get("/api/me")
async def me(user: Annotated[dict, Depends(current_user)]):
    return {"email": user["email"], "roles": user.get("ixauth_roles", [])}


@app.get("/api/reports",
         dependencies=[Depends(require_permission("page:reports:view"))])
async def reports():
    return {"rows": []}
```

`require_permission` 은 **네트워크를 타지 않는다.** 캐시된 permission-map 으로 판정하고, 토큰의 `ixauth_pv` 가 캐시 버전보다 크면 그때만 맵을 다시 받는다(폴링 없음).

### L2 — 파일·폴더 권한

```python
from ix_auth_client.fastapi import require_resource

def resolve(request: Request):
    return ("file", "/" + request.path_params["path"], "download")

@app.get("/api/files/{path:path}",
         dependencies=[Depends(require_resource(ixauth, resolve,
                                                current_user=current_user))])
async def download(path: str):
    ...
```

`/contracts/2026/a.pdf` 를 물으면 IX-Auth 가 **조상 경로**(`/contracts/2026/`, `/contracts/`, `/`)까지 함께 본다. `/contracts/` 에 준 권한이 하위로 상속되고, 형제 폴더는 걸리지 않는다.

IX-Auth 에 닿지 못하면 기본은 **거부(fail-secure)** 다. `fallback="l1"` 을 주면 L1 광역 권한으로 폴백한다.

## 실방문자 IP

IX-Auth 는 앱 뒤에 있어서 방문자의 주소를 스스로 알 수 없다. **앱이 넘기는 값이 유일한 근거**이고, 잘못 넘기면 감사 로그와 세션 목록에 경유지 주소가 박힌 채로 굳는다(사후에 진짜 주소를 되찾을 방법이 없다).

`client_ip_from` 은 이 순서로 고른다.

| 순서 | 출처 | 언제 채워지나 |
|---|---|---|
| 1 | `CF-Connecting-IP` | Cloudflare 를 거칠 때 |
| 2 | `True-Client-IP` | Akamai · Cloudflare Enterprise |
| 3 | `X-Forwarded-For` 첫 조각 | 일반 리버스 프록시 |
| 4 | `X-Real-IP` | nginx 기본 설정 |
| 5 | 소켓 주소 | 프록시가 없을 때 |

CDN 이 없으면 1·2 가 비어 있어 자연히 3 으로 떨어진다. 그래서 **어느 환경이든 이 함수 하나만 쓰면 된다.**

```python
from ix_auth_client import client_ip_from, client_meta_from

client_ip_from(request.headers)                 # FastAPI · Starlette
client_ip_from(request.META)                    # Django (HTTP_X_FORWARDED_FOR 도 읽는다)
client_ip_from(request.headers, request.client.host if request.client else None)

meta = client_meta_from(request.headers)        # {"ip": ..., "user_agent": ...}
ixauth.login(email, password, **meta)
ixauth.refresh(refresh_token, **meta)
ixauth.logout(refresh_token, **meta)
```

로그인을 마무리하는 나머지 경로도 같다: `verify_mfa` · `magic_link_verify` · `social_callback` · `federated_exchange`.

### 하면 안 되는 것

```python
ixauth.login(email, password, ip=request.client.host)          # ❌ 프록시 홉의 주소다
xff = request.headers.get("x-forwarded-for", "").split(",")[0]
ixauth.login(email, password, ip=xff)                          # ❌ CDN 뒤에서는 엣지 주소다
```

`request.client.host` 는 앱에 TCP 를 맺은 상대, 즉 리버스 프록시나 도커 브리지의 주소다. XFF 첫 조각만 믿는 것도 같은 함정으로, Cloudflare 뒤에서는 그 자리가 엣지 서버 주소로 채워져 나가는 구성이 흔하다. 2026-08-25 에 이 SDK 를 쓰는 프로젝트 두 곳에서 동시에 발견된 실제 사고다. 경위와 검수 절차는 [`docs/guides/client-ip.md`](../../docs/guides/client-ip.md).

> 갱신·로그아웃은 요청 본문에 `ip` 칸이 없다. SDK 가 `ip` 를 `X-Forwarded-For` 헤더로 실어 보내고 IX-Auth 가 그것을 읽는다. **호출 방법은 로그인과 똑같다.**

## 외부에서 확인한 신원으로 로그인 — `federated_exchange`

앱이 외부 IdP(사내 허브 등)에서 **이미 신원을 확인한** 뒤, 그 결과를 IX-Auth 세션으로 바꾼다. 계약은 [`docs/contract/http-api.md`](../../docs/contract/http-api.md) §2-7.

```python
# 앱이 OAuth 왕복·토큰 교환·userinfo 조회를 끝낸 뒤
profile = hub.userinfo(access_token)            # {"sub": ..., "email": ..., "name": ...}

r = ixauth.federated_exchange(
    "nexus-hub", profile["sub"], profile["email"], profile.get("name"),
    **client_meta_from(request.headers),
)
# r 은 login() 과 같은 봉투다 — accessToken · refreshToken · expiresIn · user
```

- **IX-Auth 는 외부 IdP 와 직접 통신하지 않는다.** 확인은 앱이 하고, jar 는 결과를 계정에 잇는 일만 한다
- `subject` 에 **이메일을 넣지 않는다.** 이메일은 바뀌고, 바뀐 주소가 남에게 재할당될 수도 있다. 매칭은 `(provider, subject)` 로만 한다
- 서버에서 `ixauth.federation.enabled` 와 `allowed-providers` 를 먼저 켜야 한다 — 끄면 `AUTH_FEDERATION_DISABLED`(403), 목록에 없으면 `AUTH_FEDERATION_PROVIDER_NOT_ALLOWED`(403)
- 발급된 access token 에는 `ixauth_idp` 클레임이 실린다. 앱이 "이 세션은 허브로 들어왔다" 를 알아야 할 때 쓴다 — **권한 판정에는 쓰지 않는다**

| 에러 코드 | 앱이 할 일 |
|-----------|-----------|
| `AUTH_FEDERATION_LINK_DENIED` (409) | "같은 주소의 계정이 이미 있다 — 관리자에게 연결을 요청하라". 다른 주소로 다시 시도하라고 하지 않는다 |
| `AUTH_FEDERATION_NO_ACCOUNT` (404) | "등록된 계정이 없다". 로그인 화면으로 되돌리면 사용자는 같은 버튼을 계속 누른다 |
| `AUTH_ACCOUNT_LOCKED` (423) · `AUTH_ACCOUNT_DISABLED` (403) | 비밀번호 로그인과 **같은 게이트**다. 상태 안내를 그대로 재사용한다 |

## 목록 화면에서는 단건 호출 금지

행마다 `check()` 를 부르면 N+1 이다.

```python
# 요청 순서대로 판정이 돌아온다
verdicts = ixauth.batch_check(user_id, [
    {"resourceType": "file", "resourceKey": k, "action": "read"} for k in keys
])

# 또는 허용된 키만 받아 필터링
res = ixauth.list_resources(user_id, "file", "read")   # {"keys": [...], "truncated": bool}
if res["truncated"]:
    # 결과가 잘린 것이지 권한이 없는 게 아니다 — 그대로 필터에 쓰면 있는 권한을 없다고 판정한다
    ...
allowed = set(res["keys"])
```

`keys` 에는 **권한이 걸린 지점**이 담긴다(`/contracts/`). 개별 파일(`/contracts/2026/a.pdf`)은 그 아래로 상속되므로 목록에 직접 나오지 않는다 — 접두사로 대조하거나 `batch_check` 를 쓴다.

## Flask·Django

프레임워크 헬퍼는 FastAPI 용만 들어 있다. 다른 프레임워크는 `IxAuthClient` 를 직접 쓴다 — 붙일 지점은 두 곳뿐이다.

```python
claims = ixauth.verify(token)                        # 요청 진입점에서
ixauth.refresh_map_if_stale(claims)
if not ixauth.has_permission(claims, "page:reports:view"):
    abort(403)
```

## 권한 코드 문법

`<domain>:<resource>:<action>` — `*` 는 한 세그먼트, `**` 는 남은 전부(마지막에만).

| 부여된 권한 | 요청 | 결과 |
|------------|------|------|
| `page:*:view` | `page:admin.users:view` | 허용 |
| `page:admin.*:view` | `page:admin.users.detail:view` | **거부** (한 단계만) |
| `page:admin.**:view` | `page:admin.users.detail:view` | 허용 |
| `file:contracts/**:download` | `file:contracts/2026/a.pdf:download` | 허용 |

`permissions.py` 는 서버의 `PermissionMatcher.java`(ix-auth-common)·`@ix-auth/client-node` 와 **같은 규칙**이다. 규칙이 갈리면 "화면엔 보이는데 API 는 403" 이 난다 — `tests/test_permissions.py` 가 세 판을 같은 케이스로 묶어 둔다.

## 환경 변수

| 변수 | 설명 |
|------|------|
| `IXAUTH_BASE_URL` | IX-Auth 주소 (기본 `http://localhost:9100`) |
| `IXAUTH_SERVICE_KEY` | 서비스 키 — **필수** |
| `IXAUTH_JWT_ISSUER` | 발급자 — **필수**, 토큰 검증에 쓴다 |

## 지켜야 할 것

- IX-Auth 는 **외부에 노출하지 않는다.** 브라우저는 앱만 보고, 앱이 대신 부른다(BFF).
- **로그인·갱신·로그아웃 모두 `ip` · `user_agent` 를 넘긴다.** 값은 `client_meta_from` 으로 뽑는다 (위 "실방문자 IP").
- 토큰은 **HttpOnly 쿠키**로. 로컬 스토리지에 두지 않는다.
- 로그인 실패 사유를 응답에 담지 않는다 — 계정 존재 여부가 새어 나간다.
- 접근 토큰·비밀번호·서비스 키를 로그에 남기지 않는다.

## 테스트

```bash
cd packages/client-python
pip install -e ".[dev]"
pytest
```

`tests/test_permissions.py` 는 외부 의존성 없이 돈다 (표준 라이브러리만).
