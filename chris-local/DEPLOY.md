# 납품 설치 절차서 (IX-Auth 로그인 스택)

> 게이트웨이 + IX-Auth 신원 서버 + PostgreSQL 을 컨테이너 3개로 세우는 절차다.\
> 모드 자체의 정본은 [AUTH-IXAUTH.md](AUTH-IXAUTH.md), 벤더 트리 취급은 [ix-auth/VENDOR.md](../ix-auth/VENDOR.md)·[ix-auth/MODULE.md](../ix-auth/MODULE.md).
>
> 작성 2026-09-07 (KST, 일요일).

---

## 0. 이 문서의 가정 (사용자 미확정)

아래 5가지는 감독 판단으로 정한 기본값이다. 고객 요건이 다르면 바꾸고, 바꾼 값을 이 문서에 적는다.

| # | 가정 | 바꾸려면 |
| --- | --- | --- |
| 1 | 관리 콘솔은 **외부에 포트를 열지 않는다.** 게이트웨이 경로 `/admin/identity/` 로만 superadmin·admin 에게 중계한다 | 별도 호스트명으로 띄우려면 `gateway.auth.ixAuth.adminConsoleUrl` 에 절대 URL 을 넣는다. 그때는 IP allowlist 나 VPN 이 반드시 앞에 있어야 한다 |
| 2 | 역할 4단계 `SUPERADMIN`/`ADMIN`/`MODERATOR`/`MEMBER` 를 **기동 시 마이그레이션으로 시드**한다 | 고객이 자기 역할 체계를 쓰면 `gateway.auth.ixAuth.roleMap` 을 그 코드에 맞춘다 |
| 3 | DB 는 **PostgreSQL 16** | MariaDB·MySQL 8 도 서버가 지원한다. `IXAUTH_DB_URL` 을 바꾸고 compose 의 `ix-auth-db` 를 교체한다 |
| 4 | 한국어 로케일은 `pnpm ui:i18n:sync` 로 채운다 | 다른 언어를 쓰면 브라우저 언어 설정을 따른다. ko 외 로케일은 아직 영어 폴백이다 (7절) |
| 5 | 호스트 포트는 **18800** | `.env` 의 `OPENCLAW_GATEWAY_PORT` 와 `OPENCLAW_PUBLIC_ORIGIN` 을 함께 바꾼다 |

## 1. 요구사항

| 항목 | 값 |
| --- | --- |
| Docker Engine | 25 이상 (실측 29.6.1) |
| Docker Compose | v2 이상 (실측 v5.2.0) |
| CPU | 4 코어 이상 |
| RAM | **8 GB 이상.** 소스에서 이미지를 빌드하면 빌드 중 6 GB 를 쓴다. 미리 만든 이미지를 반입하면 런타임 3 GB 로 충분하다 |
| 디스크 | 12 GB 이상 (게이트웨이 이미지 6.4 GB + IX-Auth 0.4 GB + 볼륨) |
| 여는 포트 | 호스트 **18800/tcp** 하나. 신원 서버와 DB 는 포트를 열지 않는다 |
| 외부 통신 | 이미지 빌드 시에만 필요(Maven Central, npm, Playwright CDN). 운영 중에는 모델 제공자 호출 외 필요 없다 |

## 2. `.env` 항목표

`chris-local/ixauth.env.example` 을 `chris-local/ixauth.env` 로 복사해 채운다. 이 파일은 `.gitignore` 에 들어 있다 (`chris-local/ixauth.env`).

| 변수 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `IXAUTH_DB_NAME` | | `ixauth` | PostgreSQL 데이터베이스 이름 |
| `IXAUTH_DB_USERNAME` | | `ixauth` | DB 사용자 |
| `IXAUTH_DB_PASSWORD` | **예** | | DB 비밀번호. `openssl rand -base64 24` |
| `IXAUTH_SERVICE_KEY` | **예** | | 게이트웨이와 신원 서버의 공유 비밀. **32자 이상**이어야 서버가 뜬다. `openssl rand -base64 36`. 브라우저에는 절대 나가지 않는다 |
| `IXAUTH_ADMIN_EMAIL` | **예** | | 최초 관리자 이메일. 첫 부팅에만 시드되고 `SUPERADMIN` 을 받는다 |
| `IXAUTH_ADMIN_PASSWORD` | **예** | | 최초 관리자 비밀번호. 아래 비밀번호 정책을 만족해야 한다 |
| `IXAUTH_ADMIN_NAME` | | `관리자` | 콘솔에 보이는 표시 이름 |
| `IXAUTH_PASSWORD_MIN_LENGTH` | | `10` | 최소 길이. 대문자·숫자·특수문자 각 1개 이상은 서버 기본값으로 항상 요구된다 |
| `IXAUTH_LOG_LEVEL` | | `INFO` | 신원 서버 로그 수준 |
| `OPENCLAW_GATEWAY_PORT` | | `18800` | 호스트에 여는 포트 |
| `OPENCLAW_PUBLIC_ORIGIN` | | `http://127.0.0.1:18800` | **브라우저가 실제로 쓰는 오리진.** 스킴·포트 포함, 끝에 `/` 없이. `gateway.controlUi.allowedOrigins` 로 들어간다 |
| `OPENCLAW_TZ` | | `Asia/Seoul` | 컨테이너 시간대 |

`issuer` 와 `audience` 는 **환경변수가 아니다.** compose 와 게이트웨이 설정 파일에 같은 리터럴(`openclaw-ix-auth` / `openclaw-gateway`)로 박아 두었다. 이 두 값을 양쪽에서 따로 맞추다 틀리는 것이 이 모드의 1번 함정이라 손댈 수 없게 한 것이다.

## 3. 기동 절차

```bash
cd <레포 루트>
cp chris-local/ixauth.env.example chris-local/ixauth.env
$EDITOR chris-local/ixauth.env        # 위 표대로 채운다

docker compose --env-file chris-local/ixauth.env \
  -f chris-local/docker-compose.ixauth.yml build       # 최초 1회, 20~40분

docker compose --env-file chris-local/ixauth.env \
  -f chris-local/docker-compose.ixauth.yml up -d
```

`up -d` 한 번으로 다음이 사람 개입 없이 끝난다.

1. PostgreSQL 초기화 (`ix-auth-db` 가 `pg_isready` 로 건강해질 때까지 다음 단계가 기다린다)
2. Flyway 마이그레이션 (`V1`~`V14`)
3. **역할 4종 시드** (`V14`. `SUPERADMIN` 에는 `ixauth:*:*` 권한도 함께 준다)
4. 서명 키 생성 + **최초 관리자 1명 시드**(`SUPERADMIN` 부여)
5. 게이트웨이가 `ixauth-gateway-config/openclaw.json` 을 상태 볼륨에 렌더링하고 `--bind lan` 으로 기동

`http://<OPENCLAW_PUBLIC_ORIGIN>` 을 열면 로그인 화면이 뜬다. 토큰도 기기 페어링도 없다.

> **`__Host-` 쿠키 주의.** HTTPS 가 아니고 루프백도 아닌 주소로 접근하면 브라우저가 세션 쿠키를 저장하지 않는다. 로컬 검증은 반드시 `http://127.0.0.1:18800` 으로 하고(`localhost` 는 다른 이름이라 오리진이 어긋난다), 실배포는 TLS 뒤에 둔다.

### 3.1 첫 로그인 직후 할 일 (운영 지시)

IX-Auth 에는 "첫 로그인 시 비밀번호 변경 강제" 기능이 **없다.** 통제 장치가 아니라 절차로 지킨다.

1. `IXAUTH_ADMIN_EMAIL` / `IXAUTH_ADMIN_PASSWORD` 로 로그인한다.
2. 계정 화면의 **사용자 관리**(`/admin/identity/`)로 들어가 콘솔에 다시 로그인한다. 콘솔이 자체 로그인을 유지하는 것은 이중 방어이며 의도한 동작이다.
3. 관리자 비밀번호를 바꾼다.
4. 실제 사용자를 만든다. 역할은 `SUPERADMIN`·`ADMIN`·`MODERATOR`·`MEMBER` 중에서 고른다.
5. `.env` 의 `IXAUTH_ADMIN_PASSWORD` 를 지운다. 첫 부팅에만 쓰이므로 이후에는 아무 효과가 없다.

### 3.2 사용자 추가

관리 콘솔에서 한다. 게이트웨이에는 사용자 관리 화면이 없다.

| 게이트웨이 역할 | 세션 타인 열람 | 사용자 관리 링크 |
| --- | --- | --- |
| `superadmin` | 쓰기 | 보인다 |
| `admin` | 쓰기 | 보인다 |
| `moderator` | 제안 | 안 보인다 |
| `member` | 보기 | 안 보인다 |

링크는 감추는 것이 아니라 **응답 본문에 싣지 않는다.** 주소를 직접 입력해도 403 이다.

## 4. 백업 · 복구

볼륨 2개가 상태의 전부다.

| 볼륨 | 담는 것 | 잃으면 |
| --- | --- | --- |
| `openclaw-ixauth_ix-auth-db-data` | 계정·역할·세션·감사 원장·서명 키 | 계정을 전부 다시 만든다 |
| `openclaw-ixauth_gateway-state` | 게이트웨이 SQLite(프로필·로그인 세션·대화), 워크스페이스 | 대화 이력과 로그인 세션이 사라진다 |

```bash
# 백업 (정지 상태에서 뜨는 것이 안전하다)
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml stop
docker run --rm -v openclaw-ixauth_ix-auth-db-data:/v -v "$PWD/backup:/out" alpine \
  tar czf /out/ix-auth-db-$(date +%Y%m%d).tar.gz -C /v .
docker run --rm -v openclaw-ixauth_gateway-state:/v -v "$PWD/backup:/out" alpine \
  tar czf /out/gateway-state-$(date +%Y%m%d).tar.gz -C /v .
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml start

# 복구
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml down
docker volume rm openclaw-ixauth_ix-auth-db-data openclaw-ixauth_gateway-state
docker volume create openclaw-ixauth_ix-auth-db-data
docker volume create openclaw-ixauth_gateway-state
docker run --rm -v openclaw-ixauth_ix-auth-db-data:/v -v "$PWD/backup:/in" alpine \
  tar xzf /in/ix-auth-db-<날짜>.tar.gz -C /v
docker run --rm -v openclaw-ixauth_gateway-state:/v -v "$PWD/backup:/in" alpine \
  tar xzf /in/gateway-state-<날짜>.tar.gz -C /v
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml up -d
```

**두 볼륨은 한 벌로 백업하고 한 벌로 복구한다.** 게이트웨이 세션 행이 IX-Auth 의 refresh 토큰을 들고 있어서, 한쪽만 옛 시점으로 되돌리면 로그인한 사람이 전부 튕긴다(다시 로그인하면 회복된다).

`IXAUTH_SERVICE_KEY` 를 바꾸면 등록된 TOTP 가 전부 무효가 된다(서버가 MFA 암호화 키를 이 값에서 파생한다). 키 회전은 2단계 인증 재등록 안내와 함께 한다.

## 5. 업그레이드

```bash
git pull
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml build
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml up -d
```

- 볼륨은 유지된다. Flyway 가 새 마이그레이션만 적용한다.
- 게이트웨이 설정은 `ixauth-gateway-config/openclaw.json` 이 정본이고 **매 기동마다 상태 볼륨에 덮어쓴다.** 설정을 바꾸려면 컨테이너 안이 아니라 이 파일을 고친다.
- 업그레이드 전에 4절 백업을 먼저 뜬다.

## 6. 되돌리기

| 상황 | 조치 |
| --- | --- |
| 이번 이미지가 문제 | 이전 이미지 태그로 `docker compose up -d` (빌드본이면 4절 백업 복구가 더 확실하다) |
| 로그인 모드 자체를 되돌린다 | [AUTH-IXAUTH.md](AUTH-IXAUTH.md) 8절. `ix_auth_login_sessions` 를 DROP 하지 않고 IX-Auth DB 도 지우지 않는다 |
| 급히 전원을 끊어야 한다 | `docker compose stop gateway`. DB 와 신원 서버는 살려 둔다 |

## 7. 포트 · 방화벽

| 대상 | 포트 | 노출 |
| --- | --- | --- |
| 게이트웨이 | 호스트 `18800` -> 컨테이너 `18789` | **여는 유일한 포트** |
| IX-Auth | 컨테이너 `9100` | compose 내부망만. `ports` 없음 (설계 불변식 4) |
| PostgreSQL | 컨테이너 `5432` | compose 내부망만 |

- 운영에서는 18800 을 리버스 프록시(TLS 종단) 뒤에 두고, 호스트 방화벽에서 18800 을 프록시 주소로만 연다.
- Docker 는 `iptables` 를 직접 만지므로 `ufw` 규칙이 컨테이너 포트에 먹지 않는다. `DOCKER-USER` 체인에 넣거나 `ports` 를 `127.0.0.1:18800:18789` 로 바꿔 프록시가 같은 호스트에서만 붙게 한다.
- 게이트웨이는 컨테이너 안에서 `0.0.0.0` 에 바인드한다. 루프백 바인드로는 브리지 네트워크의 `-p` 가 닿지 않기 때문이고, 그래도 안전한 이유는 `gateway.auth.mode` 가 `ix-auth` 라 인증 없는 표면이 없어서다.

## 8. 라이선스 확인 항목 (납품 전 법무 확인 필요)

| 대상 | 라이선스 | 상태 |
| --- | --- | --- |
| **IX-Auth** (`ix-auth/`) | `package.json` 이 `UNLICENSED` | **미해결.** 아래 |
| 게이트웨이 | MIT | 문제 없음 |
| `postgres:16-alpine` | PostgreSQL License (BSD 계열) | 문제 없음 |
| Chromium (`OPENCLAW_INSTALL_BROWSER=1`) | BSD 계열 + 다수 | 고지 의무 확인 |
| Noto CJK 폰트 | SIL OFL 1.1 | 재배포 시 라이선스 동봉 |

**IX-Auth 는 사내 제품이고 `UNLICENSED` 로 표기돼 있다.** 이 상태로 외부 고객에게 이미지를 넘기면 배포 권원이 문서로 남지 않는다. 납품 전에 확정해야 할 것:

1. 이 포크에 IX-Auth 를 동봉해 배포할 권한이 있는가 (사내 제품이라도 명시적 허가가 문서에 남아야 한다).
2. 고객이 받는 것이 사용권인가 소스 포함인가.
3. 상용 라이선스가 필요한 배포 형태인가 (`ix-auth/VENDOR.md` 의 원본 저장소 정책과 대조).

이 항목은 **기술로 해결되지 않는다.** 사용자 결정 사항으로 남긴다.

## 9. 진단

| 증상 | 확인 |
| --- | --- |
| `up -d` 후 게이트웨이가 계속 재시작한다 | `docker compose ... logs gateway`. 설정 오류면 `Gateway start blocked:` 로 시작하는 줄이 이유를 말한다 |
| 로그인 폼에서 403 `origin_not_allowed` | `OPENCLAW_PUBLIC_ORIGIN` 이 브라우저 주소창의 오리진과 글자 그대로 같은지. 다시 기동해야 반영된다 |
| 로그인 200 인데 바로 로그아웃된다 | issuer/audience 불일치. 이 스택에서는 양쪽에 박혀 있으므로, 설정 파일을 손댔다면 되돌린다 |
| 쿠키가 아예 저장되지 않는다 | HTTPS 도 루프백도 아닌 주소. `__Host-` 쿠키는 그런 곳에 저장되지 않는다 |
| 사용자 관리가 403 | 그 계정의 역할이 `superadmin`·`admin` 이 아니다. 콘솔에서 역할을 바꾸고 세션을 종료한다 |
| 콘솔에서 저장이 403 `csrf_mismatch` | 게이트웨이 세션이 만료됐다. Control UI 탭을 새로 고쳐 로그인한 뒤 콘솔을 다시 연다 |
| 신원 서버가 뜨지 않는다 | `IXAUTH_SERVICE_KEY` 가 32자 미만이면 부팅을 거부한다 |
| 나머지 | [AUTH-IXAUTH.md](AUTH-IXAUTH.md) 7.4 |

## 10. 확인된 제약

| 제약 | 내용 |
| --- | --- |
| 역할 변경 반영 지연 | 콘솔에서 역할만 바꾸면 최대 15분 늦게 반영된다. 즉시 반영하려면 세션도 함께 종료한다 (AUTH-IXAUTH.md 7.3) |
| 부서 접근 강제 | 미구현. 완화책으로 `tools.sessions.visibility` 를 `self` 로 좁혀 두었다 |
| 초대장 가입 화면 | 미구현. 계정은 콘솔에서 만든다 |
| ko 외 로케일 | 번역 제공자 없이 동기화해 영어 폴백 상태다. `pnpm ui:i18n:check` 가 그 때문에 실패한다 |
| 메일 | SMTP 설정이 없다. 비밀번호 재설정·초대 메일은 보내지지 않는다 |
