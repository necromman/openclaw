# 실방문자 IP 전달 가이드

IX-Auth 의 감사 로그와 세션 목록에 **방문자의 진짜 주소**가 남게 하는 방법. 계약은 [`../contract/http-api.md`](../contract/http-api.md) 2절, 판정 코드는 서버의 `common/ClientInfo.java` 다.

---

## 1. 왜 이 문서가 있는가

IX-Auth 는 앱 뒤에 있다. 브라우저는 jar 를 직접 부르지 않고 앱이 중계하므로(설계 불변식 4), jar 가 보는 상대는 언제나 **앱 서버**다. 그래서 방문자의 주소는 **앱이 넘겨 주는 값이 유일한 근거**다.

여기서 실수하면 이렇게 된다.

- 감사 로그의 `ip` 가 전부 같은 주소(도커 브리지 · 리버스 프록시 · CDN 엣지)로 찍힌다
- 세션 목록의 "어디서 로그인했는가" 가 의미를 잃고, 낯선 기기 알림 메일도 기준을 잃는다
- 로그인 속도 제한이 방문자별이 아니라 **앱 하나 단위**로 걸린다(계약 6절)
- **되돌릴 수 없다.** 이미 쌓인 줄에서 진짜 주소를 복원할 방법이 없다

그런데 이 실수는 화면에 아무 증상도 내지 않는다. 로그인은 잘 되고, 값도 비어 있지 않다. 사고가 나서 로그를 뒤지는 날에야 드러난다.

> **2026-08-25 실측.** 소비 프로젝트 두 곳(ax-ir-minimal · ax-edu-poc)이 **둘 다** 틀리게 연동돼 있었다. 한 곳은 `X-Forwarded-For` 의 첫 조각을, 다른 한 곳은 `request.client.host` 를 넘기고 있었다. 두 곳 다 운영이 Cloudflare 를 거치기 때문에 감사 로그가 전부 경유지 주소로 남아 있었다. 서로 다른 팀이 서로 다른 방식으로 같은 함정에 빠졌다는 것은, 이것이 "조심하면 되는 일" 이 아니라 **구조로 막아야 하는 일**이라는 뜻이다.

---

## 2. 도출 우선순위

```
1. CF-Connecting-IP          Cloudflare 가 채워 넣는 실방문자 주소
2. True-Client-IP            Akamai · Cloudflare Enterprise 의 같은 뜻 헤더
3. X-Forwarded-For 첫 조각    일반 리버스 프록시
4. X-Real-IP                 nginx 기본 설정
5. 소켓 주소                  프록시가 하나도 없을 때
```

**CDN 이 없으면 1·2 가 비어 있어 자연히 3 으로 떨어진다.** 그래서 이 순서는 환경을 따지지 않고 그대로 쓰면 된다. 개발 · 스테이징 · 운영에서 코드가 달라질 이유가 없다.

### 왜 XFF 를 먼저 보면 안 되는가

`X-Forwarded-For` 는 경유지가 **덧붙이는** 헤더다. "맨 앞이 최종 사용자" 라는 규칙은 앞단이 정직할 때만 성립한다. Cloudflare 를 거치는 구성에서는 엣지가 자기 주소로 그 자리를 채워 보내는 경우가 흔하고, 그러면 첫 조각은 방문자가 아니라 **엣지 서버**다. 위 사고 두 건 중 한 건이 정확히 이 모양이었다.

### 왜 소켓 주소를 쓰면 안 되는가

`request.client.host`(FastAPI) · `req.socket.remoteAddress`(Node) · `getRemoteAddr()`(Servlet) 는 **앱에 TCP 를 맺은 상대**의 주소다. 앞에 nginx 나 도커 브리지가 있으면 그 주소가 나온다. 프록시가 하나도 없을 때만 방문자와 일치하므로, 우선순위의 맨 끝(5번)에만 둔다.

`req.ip`(Express)도 같은 함정이다. `trust proxy` 를 켜도 **XFF 만** 보므로 Cloudflare 뒤에서는 엣지 주소를 준다.

---

## 3. 어떻게 전달하는가

### 본문에 `ip` 칸이 있는 엔드포인트

`POST /auth/login` · `POST /auth/magic-link/verify` 는 요청 본문에 `ip` · `userAgent` 를 받는다. 명시값이 가장 우선한다.

### 본문에 `ip` 칸이 없는 엔드포인트

`POST /auth/refresh` · `POST /auth/logout` 을 비롯한 나머지 호출에는 그 칸이 없다. **그 대신 `X-Forwarded-For` 헤더로 전달한다.** jar 의 `ClientInfo` 가 명시값 다음으로 그 헤더를 보기 때문에 결과는 같다.

```
POST /auth/refresh
X-IxAuth-Key: <service key>
X-Forwarded-For: 203.0.113.7
User-Agent: Mozilla/5.0 (...)
```

jar 는 인터넷에 열리지 않고 앱만 호출할 수 있으므로(설계 불변식 4), 이 헤더를 신뢰하는 것이 설계 의도다. 반대로 jar 를 외부에 노출한다면 그 자체가 설계 위반이고, 그 순간 이 헤더는 위조 가능해진다.

> **갱신을 빼먹기 쉽다.** 로그인만 고치고 끝내면 세션 기록의 IP 가 갱신 때마다 앱 서버 주소로 덮인다. 15분마다 도는 호출이라 결국 대부분의 줄이 그렇게 된다.

---

## 4. SDK 를 쓰면 저절로 맞는다

두 SDK 에 헤더 묶음에서 IP 를 뽑는 헬퍼가 있다. 우선순위 체인은 위 2절과 같고, 세 호출 전부에 `meta` 를 넘기면 나머지는 SDK 가 한다.

### Node (`@ix-auth/client-node`)

```js
import { createIxAuthClient, requestMeta, clientIpFrom } from '@ix-auth/client-node'

app.post('/api/login', async (req, res) => {
  const r = await ixauth.login(req.body.email, req.body.password, requestMeta(req))
  ...
})

await ixauth.refresh(refreshToken, requestMeta(req))
await ixauth.logout(refreshToken, requestMeta(req))

clientIpFrom(request.headers)            // fetch Request · Next.js 도 그대로 받는다
```

`authenticate()` 미들웨어가 자동으로 도는 갱신에도 이미 붙어 있다.

### Python (`ix-auth-client`)

```python
from ix_auth_client import client_meta_from

meta = client_meta_from(request.headers)          # {"ip": ..., "user_agent": ...}
ixauth.login(email, password, **meta)
ixauth.refresh(refresh_token, **meta)
ixauth.logout(refresh_token, **meta)
```

Django 는 `client_meta_from(request.META)` 로 부른다(`HTTP_X_FORWARDED_FOR` 표기도 읽는다).

로그인을 마무리하는 나머지 경로도 같다: `verify_mfa` · `magic_link_verify` · `social_callback`.

---

## 5. 서버가 이렇게 경고한다

문서와 SDK 만으로는 부족하다. 잘못 연동해도 아무 증상이 없기 때문에, **서버가 스스로 알아채 시스템 로그에 경고를 띄운다**(`common/ClientIpGuard.java`).

감사 기록이 남는 순간 그 IP 가 **방문자일 수 없는 주소**인지 본다.

| 갈래 | 대역 | 경고 |
|---|---|---|
| 사설망 | `10/8` · `172.16/12` · `192.168/16` · `fc00::/7` | 연동 앱이 실방문자 IP 를 넘기지 않았습니다 |
| 링크로컬 | `169.254/16` · `fe80::/10` | 위와 같음 |
| CDN 엣지 | Cloudflare 공개 IPv4 15개 대역 | X-Forwarded-For 첫 조각 대신 CF-Connecting-IP 를 우선하세요 |
| 루프백 | `127/8` · `::1` | `STRICT` 일 때만 |

```
WARN  [client-ip-guard] LOGIN_SUCCESS 의 감사 IP 172.19.0.1 은 사설망 주소입니다 -
      연동 앱이 실방문자 IP 를 넘기지 않았습니다. 로그인은 본문 ip, 갱신·로그아웃은
      X-Forwarded-For 헤더로 전달하세요 (docs/guides/client-ip.md · 이 원인 누적 3건,
      10분에 한 번만 알립니다)
```

- **기록을 바꾸지는 않는다.** 넘어온 값을 그대로 적고 경고만 붙인다. 서버가 값을 고쳐 적으면 잘못된 연동이 더 조용해진다
- **로그인 경로에서만 본다** (`LOGIN_SUCCESS`·`LOGIN_FAILURE`·`LOGOUT`·`TOKEN_REFRESHED`·`NEW_DEVICE_LOGIN`·MFA 3종·`REFRESH_REUSE_DETECTED`). 관리 API 나 배치의 IP 는 내부망 주소인 것이 정상이라 그것까지 경고하면 소음이 된다. 잘못된 연동은 어차피 로그인에서 100% 드러난다
- **같은 이벤트·같은 원인은 10분에 한 번만** 찍는다. 감지 건수는 억제와 무관하게 전부 센다
- **루프백은 기본에서 넘긴다.** 로컬 개발은 앱도 jar 도 같은 호스트라 방문자가 실제로 `127.0.0.1` 이다. 그것까지 경고하면 개발 중 모든 로그인이 경고를 찍고, 늘 켜져 있는 경고는 곧 아무도 읽지 않는다. 앱과 jar 가 다른 호스트인 운영에서는 `STRICT` 로 올려 그 경우도 잡는다

### 설정

| 키 | 기본값 | 값 |
|---|---|---|
| `ixauth.audit.client-ip-guard` | `WARN` | `OFF` · `WARN` · `STRICT` |

관리 화면 "감사 로그" 그룹에서 바꿀 수 있다.

### 로그를 보지 않는 사람을 위해

`GET /admin/system/status` 응답에 한 칸이 붙는다. `detections` 가 0 이 아니면 감사 로그가 지금 경유지 주소로 쌓이는 중이다.

```json
{ "clientIpGuard": {
  "mode": "WARN", "detections": 42,
  "lastAt": "2026-08-25T10:12:00Z", "lastIp": "172.19.0.1",
  "lastReason": "PRIVATE", "lastEvent": "LOGIN_SUCCESS"
} }
```

---

## 6. 연동 검수 체크리스트

문서를 읽었다는 것으로 끝내지 않는다. **직접 눌러 보고 DB 를 본다.**

1. 운영(또는 스테이징)에 브라우저로 **로그인**한다. 사내망이 아니라 실제 방문자와 같은 경로로 들어간다
2. `select ip, user_agent, event_type, created_at from ixauth.audit_logs order by id desc limit 5;`
   - `ip` 가 **내 공인 IP** 와 같은가. 같은 값이 반복해 찍히거나 사설망 대역이면 틀린 것이다
3. 15분을 기다리거나 access token 을 만료시켜 **갱신**을 한 번 태운 뒤 `TOKEN_REFRESHED` 줄을 같은 방법으로 본다
   - 로그인만 고치고 갱신을 빼먹는 실수가 가장 흔하다
4. `select ip, user_agent, issued_at from ixauth.sessions order by issued_at desc limit 5;` 도 같은 값인지 본다
5. **로그아웃** 후 `LOGOUT` 줄을 본다
6. jar 의 시스템 로그에 `[client-ip-guard]` 가 하나도 없어야 한다. 있으면 그 줄이 원인과 해법을 그대로 알려 준다
7. `GET /admin/system/status` 의 `clientIpGuard.detections` 가 `0` 인지 확인한다

CDN 구성을 바꿨을 때(Cloudflare 를 붙이거나 뗐을 때)는 **다시 한다.** 그때 조용히 깨지는 것이 이 값이다.
