# IX-Auth 로그인 데모 (React + Vite + Node BFF)

IX-Auth 를 실제 앱에 붙여 보는 최소 예제. **로그인만** 확인한다.

```
브라우저 ──▶ Vite(5173) ──proxy──▶ Node BFF(8080) ──▶ ix-auth.jar(9100) ──▶ PostgreSQL
                                        │
                                        └─ 매 요청 토큰 검증은 여기서 로컬 처리 (jar 미경유)
```

---

## 이 예제가 보여주는 것

| # | 확인 대상 | 어디서 보나 |
|---|----------|-----------|
| 1 | **앱이 jar 없이 토큰을 검증한다** (설계 불변식 2) | 화면의 "로컬 검증 계측" — jar 를 꺼도 로그인 상태가 유지된다 |
| 2 | **브라우저가 jar 를 직접 호출하지 않는다** (불변식 4) | 프론트 코드에 jar 주소·서비스 키가 없다. BFF 만 안다 |
| 3 | 권한 판정도 로컬에서 한다 | "권한 판정 실험" — 와일드카드 매칭이 앱 안에서 계산된다 |
| 4 | 로그인 실패가 계정 존재를 노출하지 않는다 | 없는 계정과 틀린 비밀번호가 같은 응답 |
| 5 | 403 이 사유를 알려주지 않는다 | "보호된 API" 거부 응답 |
| 6 | **앱이 만들어야 하는 계정 화면** | "내 계정" 탭 — 비밀번호 변경 · 이메일 변경 · 소셜 연결 · 내 기기 |
| 7 | 소셜 콜백을 앱이 받는다 (불변식 4) | BFF 의 `/oauth/:provider` — provider 는 **화면 주소**로 돌려보낸다 |

**BFF 의 `server/src/ixauth.js` 가 SDK 원형이다.** 실제 SDK 도 이 이상 커지지 않는다 —
토큰 꺼내기 · JWKS 검증 · 권한 판정 · 로그인 중계, 네 가지뿐이다.

---

## 빠른 실행

```bash
./run-demo.sh          # DB → jar → BFF → 화면 한 번에
./run-demo.sh stop     # 정리
```

→ http://localhost:55173 · 계정 `admin@demo.local` / `Dem0!Passw0rd`

> 스크립트는 개발 PC 의 흔한 포트와 겹치지 않게 높은 번호를 쓴다
> (DB 55432 · jar 59100 · BFF 58080 · 화면 55173). 아래 수동 절차는 기본 포트(9100/8080/5173) 기준이다.

---

## 수동 실행

### 1. DB + IX-Auth

```bash
docker run -d --name ixauth-demo-db \
  -e POSTGRES_DB=demoapp -e POSTGRES_USER=demoapp -e POSTGRES_PASSWORD=demo-pass \
  -p 55432:5432 postgres:16-alpine

# 레포 루트에서
./gradlew :ix-auth-server:bootJar

IXAUTH_DB_URL=jdbc:postgresql://localhost:55432/demoapp \
IXAUTH_DB_USERNAME=demoapp \
IXAUTH_DB_PASSWORD=demo-pass \
IXAUTH_JWT_ISSUER=https://demo.local \
IXAUTH_SERVICE_KEY=demo-service-key-at-least-32-characters \
IXAUTH_ADMIN_EMAIL=admin@demo.local \
IXAUTH_ADMIN_PASSWORD='Dem0!Passw0rd' \
IXAUTH_PORT=9100 \
java -jar ix-auth-server/build/libs/ix-auth.jar
```

부팅하면 `ixauth` 스키마가 자동 생성되고 관리자 계정이 만들어진다. SQL 을 손댈 일이 없다.

### 2. BFF

```bash
cd examples/react-demo/server
npm install

IXAUTH_BASE_URL=http://localhost:9100 \
IXAUTH_SERVICE_KEY=demo-service-key-at-least-32-characters \
IXAUTH_JWT_ISSUER=https://demo.local \
npm start
```

### 3. 프론트

```bash
cd examples/react-demo/web
npm install
npm run dev
```

→ http://localhost:5173 · 계정 `admin@demo.local` / `Dem0!Passw0rd`

---

## 해볼 것

**① jar 를 꺼 본다**

로그인한 뒤 jar 프로세스를 종료한다. 화면의 상태 배지가 "응답 없음"으로 바뀌지만
**로그인 상태와 보호된 API 는 그대로 동작한다.** 새 로그인만 안 된다.

이게 사이드카 방식의 핵심이다 — 인증 서버가 앱의 가용성을 좌우하지 않는다.

**② 권한을 부여해 본다**

`page:reports:view` 는 처음엔 거부된다. 관리 화면(http://localhost:9100/admin-ui)에서
권한을 등록하고 ADMIN 역할에 부여한 뒤 **다시 로그인**하면 통과한다.

재로그인이 필요한 이유: 권한 변경은 토큰의 `pv` 가 올라가야 앱 캐시에 전파된다.\
즉시 반영이 필요하면 관리 화면에서 해당 사용자의 세션을 폐기한다.

**③ 없는 계정으로 로그인해 본다**

`nobody@demo.local` 로 시도해도 틀린 비밀번호와 똑같은 메시지가 나온다.

**④ "내 계정" 탭을 열어 본다**

비밀번호 변경 · 이메일 변경 · 소셜 연결 · 내 기기(세션). **여기가 앱이 만들어야 하는 화면이다** —
IX-Auth 는 정책·토큰·메일·세션 폐기를 다 하지만 화면은 만들지 않는다(불변식 1).

- 비밀번호를 바꾸면 **모든 세션이 끊겨** 그 자리에서 로그아웃된다 (화면이 미리 알린다)
- 이메일 변경은 새 주소로 확인 메일이 가고, **그 링크를 열어야** 바뀐다. 데모는 `transport=LOG`
  이므로 링크가 jar 로그(`$TMPDIR/ixauth-demo-jar.log`)에 찍힌다
- 소셜은 기본이 꺼짐이다 → "설정된 소셜 로그인이 없다" 가 정상이다

---

## 소셜 로그인을 켜 보려면

jar 기동 환경변수에 provider 를 하나 켜면 로그인 화면에 버튼이, "내 계정" 에 연결 항목이 생긴다.

**버튼은 하드코딩이 아니라 `/api/social/providers` 응답으로 그려진다** — 끈 provider 의 버튼이
남아 "눌렀는데 안 되는" 상태가 생기지 않게 한 것이다.

```bash
IXAUTH_SOCIAL_ENABLED=true
IXAUTH_SOCIAL_KAKAO_ENABLED=true
IXAUTH_SOCIAL_KAKAO_CLIENT_ID=<REST API 키>
IXAUTH_SOCIAL_KAKAO_CLIENT_SECRET=<시크릿>
```

provider 콘솔에 등록할 Redirect URI 는 **화면 주소**다 (BFF 포트가 아니다).

| 용도 | URI |
|------|-----|
| 로그인 | `http://localhost:55173/oauth/kakao` |
| 내 계정에서 연결 | `http://localhost:55173/oauth/kakao/link` |

BFF 는 이 주소를 `APP_BASE_URL` 로 만든다(`run-demo.sh` 가 넘긴다). Vite 가 `/oauth` 를 BFF 로
프록시하므로 콜백이 BFF 까지 도착한다 — 이 프록시가 없으면 동의까지 마친 사용자가 404 를 본다.

자세한 것은 [`docs/guides/social-login.md`](../../docs/guides/social-login.md).

---

## 정리

```bash
docker rm -f ixauth-demo-db
```
