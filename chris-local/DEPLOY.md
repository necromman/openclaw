# 납품 설치 절차서 (IX-Auth 로그인 스택)

> 게이트웨이 + IX-Auth 신원 서버 + PostgreSQL 을 컨테이너 3개로 세우는 절차다.\
> 모드 자체의 정본은 [AUTH-IXAUTH.md](AUTH-IXAUTH.md), 벤더 트리 취급은 [ix-auth/VENDOR.md](../ix-auth/VENDOR.md)·[ix-auth/MODULE.md](../ix-auth/MODULE.md).
>
> 작성 2026-09-07 (KST, 일요일).

---

## 0. 이 문서의 가정 (사용자 미확정)

아래 7가지 가운데 7번은 사용자가 확정한 값이고, 나머지는 감독 판단으로 정한 기본값이다. 고객 요건이 다르면 바꾸고, 바꾼 값을 이 문서에 적는다.

| #   | 가정                                                                                                                                                                                | 바꾸려면                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 관리 콘솔은 **외부에 포트를 열지 않는다.** 게이트웨이 경로 `/admin/identity/` 로만 superadmin·admin 에게 중계한다                                                                   | 별도 호스트명으로 띄우려면 `gateway.auth.ixAuth.adminConsoleUrl` 에 절대 URL 을 넣는다. 그때는 IP allowlist 나 VPN 이 반드시 앞에 있어야 한다 |
| 2   | 역할 5단계 `SUPERADMIN`/`ADMIN`/`EXECUTIVE`/`MODERATOR`/`MEMBER` 를 **기동 시 마이그레이션으로 시드**한다                                                                           | 고객이 자기 역할 체계를 쓰면 `gateway.auth.ixAuth.roleMap` 을 그 코드에 맞춘다                                                                |
| 3   | DB 는 **PostgreSQL 16**                                                                                                                                                             | MariaDB·MySQL 8 도 서버가 지원한다. `IXAUTH_DB_URL` 을 바꾸고 compose 의 `ix-auth-db` 를 교체한다                                             |
| 4   | 한국어 로케일은 `pnpm ui:i18n:sync` 로 채운다                                                                                                                                       | 다른 언어를 쓰면 브라우저 언어 설정을 따른다. ko 외 로케일은 아직 영어 폴백이다 (7절)                                                         |
| 5   | 호스트 포트는 **18800**                                                                                                                                                             | `.env` 의 `OPENCLAW_GATEWAY_PORT` 와 `OPENCLAW_PUBLIC_ORIGIN` 을 함께 바꾼다                                                                  |
| 6   | 부서 강제를 **켠 채로** 납품한다 (`tools.sessions.visibility: "department"`, 부서 코드 `dept-<slug>`)                                                                               | 부서를 안 쓰는 고객이면 그 값을 `"self"` 로 되돌린다. 접두사는 `gateway.auth.ixAuth.departmentGroupPrefix` (AUTH-DEPARTMENTS.md 4·5절)        |
| 7   | **사용자 확정(2026-09-07).** 주소는 `https://jinbio.botops.cloud`, TLS 는 Cloudflare Tunnel 로 붙인다. PoC·데모·초기 운영 한정이고 정식 납품 시 진바이오테크 자체 도메인으로 옮긴다 | 절차·되돌리기는 11.7. 도메인 없이 사내 IP 로만 쓰려면 11.1 로 간다                                                                            |

## 1. 요구사항

| 항목           | 값                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Docker Engine  | 25 이상 (실측 29.6.1)                                                                                               |
| Docker Compose | v2 이상 (실측 v5.2.0)                                                                                               |
| CPU            | 4 코어 이상                                                                                                         |
| RAM            | **8 GB 이상.** 소스에서 이미지를 빌드하면 빌드 중 6 GB 를 쓴다. 미리 만든 이미지를 반입하면 런타임 3 GB 로 충분하다 |
| 디스크         | 12 GB 이상 (게이트웨이 이미지 6.4 GB + IX-Auth 0.4 GB + 볼륨)                                                       |
| 여는 포트      | 호스트 **18800/tcp** 하나. 신원 서버와 DB 는 포트를 열지 않는다                                                     |
| 외부 통신      | 이미지 빌드 시에만 필요(Maven Central, npm, Playwright CDN). 운영 중에는 모델 제공자 호출 외 필요 없다              |

## 2. `.env` 항목표

`chris-local/ixauth.env.example` 을 `chris-local/ixauth.env` 로 복사해 채운다. 이 파일은 `.gitignore` 에 들어 있다 (`chris-local/ixauth.env`).

| 변수                                    | 필수   | 기본값                                | 설명                                                                                                                                                                                          |
| --------------------------------------- | ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IXAUTH_DB_NAME`                        |        | `ixauth`                              | PostgreSQL 데이터베이스 이름                                                                                                                                                                  |
| `IXAUTH_DB_USERNAME`                    |        | `ixauth`                              | DB 사용자                                                                                                                                                                                     |
| `IXAUTH_DB_PASSWORD`                    | **예** |                                       | DB 비밀번호. `openssl rand -base64 24`                                                                                                                                                        |
| `IXAUTH_SERVICE_KEY`                    | **예** |                                       | 게이트웨이와 신원 서버의 공유 비밀. **32자 이상**이어야 서버가 뜬다. `openssl rand -base64 36`. 브라우저에는 절대 나가지 않는다                                                               |
| `IXAUTH_ADMIN_EMAIL`                    | **예** |                                       | 최초 관리자 이메일. 첫 부팅에만 시드되고 `SUPERADMIN` 을 받는다                                                                                                                               |
| `IXAUTH_ADMIN_PASSWORD`                 | **예** |                                       | 최초 관리자 비밀번호. 아래 비밀번호 정책을 만족해야 한다                                                                                                                                      |
| `IXAUTH_ADMIN_NAME`                     |        | `관리자`                              | 콘솔에 보이는 표시 이름                                                                                                                                                                       |
| `IXAUTH_PASSWORD_MIN_LENGTH`            |        | `10`                                  | 최소 길이. 대문자·숫자·특수문자 각 1개 이상은 서버 기본값으로 항상 요구된다                                                                                                                   |
| `IXAUTH_LOG_LEVEL`                      |        | `INFO`                                | 신원 서버 로그 수준                                                                                                                                                                           |
| `IXAUTH_ACCOUNT_SIGNUP_MODE`            |        | `CLOSED`                              | 자체 가입 모드. 계정은 관리자가 만든다. `OPEN`·`APPROVAL` 은 메일이 먼저 있어야 한다                                                                                                          |
| `IXAUTH_ACCOUNT_SIGNUP_VERIFICATION`    |        | `EMAIL`                               | 가입 본인확인. `EMAIL` 인증 메일 / `NONE` 생략 / `PASS` 별도 연동                                                                                                                             |
| `IXAUTH_ACCOUNT_SIGNUP_ALLOWED_DOMAINS` |        | (없음)                                | 가입 허용 도메인. 쉼표로 구분. 비우면 제한 없음. 초대에는 적용되지 않는다                                                                                                                     |
| `IXAUTH_ACCOUNT_INVITE_TOKEN_TTL`       |        | `72h`                                 | 초대 링크 수명. 원본 기본값 `7d` 에서 줄였다                                                                                                                                                  |
| `IXAUTH_MAIL_TRANSPORT`                 |        | `WEBHOOK`                             | `WEBHOOK` 게이트웨이가 초대 링크를 보관 / `SMTP` 실제 발송 / `LOG` 개발용. 자세한 것은 AUTH-SIGNUP.md 6.1                                                                                     |
| `IXAUTH_MAIL_WEBHOOK_URL`               |        | `http://gateway:18789/auth/mail-hook` | WEBHOOK 일 때만 읽는다. 컴포즈 네트워크 주소이지 브라우저 오리진이 아니다                                                                                                                     |
| `IXAUTH_MAIL_FROM`                      |        | `no-reply@localhost`                  | 보내는 사람                                                                                                                                                                                   |
| `IXAUTH_MAIL_PRODUCT_NAME`              |        | `Chris Agent`                         | 메일 제목·본문에 쓰는 제품명                                                                                                                                                                  |
| `IXAUTH_MAIL_SMTP_HOST`                 |        |                                       | SMTP 서버. `IXAUTH_MAIL_TRANSPORT=SMTP` 일 때만 읽는다                                                                                                                                        |
| `IXAUTH_MAIL_SMTP_PORT`                 |        | `587`                                 | SMTP 포트                                                                                                                                                                                     |
| `IXAUTH_MAIL_SMTP_USERNAME`             |        |                                       | 비우면 인증 없이 보낸다                                                                                                                                                                       |
| `IXAUTH_MAIL_SMTP_PASSWORD`             |        |                                       | 위와 같다                                                                                                                                                                                     |
| `IXAUTH_MAIL_SMTP_STARTTLS`             |        | `true`                                | STARTTLS 사용 여부                                                                                                                                                                            |
| `MAILPIT_UI_PORT`                       |        | `18025`                               | 개발용 수신함(`--profile mail`)의 호스트 포트                                                                                                                                                 |
| `OPENCLAW_GATEWAY_PORT`                 |        | `18800`                               | 호스트에 여는 포트                                                                                                                                                                            |
| `OPENCLAW_PUBLIC_ORIGIN`                |        | `http://127.0.0.1:18800`              | **브라우저가 실제로 쓰는 오리진.** 스킴·포트 포함, 끝에 `/` 없이. `gateway.controlUi.allowedOrigins` 로 들어간다. 터널을 쓰면 `https://jinbio.botops.cloud` (11.7)                            |
| `OPENCLAW_TRUSTED_PROXIES`              |        | (없음)                                | `x-forwarded-proto` 를 믿어도 되는 앞단 주소 목록, 쉼표 구분. 비우면 게이트웨이가 모든 접속을 평문으로 보고 `__Host-` 없는 쿠키를 내린다. TLS 종단이 앞에 실제로 있을 때만 채운다 (11.3·11.7) |
| `CLOUDFLARE_TUNNEL_TOKEN`               |        | (없음)                                | Cloudflare Tunnel 토큰. `--profile tunnel` 일 때만 읽는다. 시크릿이므로 `.env` 에만 두고 어디에도 커밋하지 않는다 (11.7)                                                                      |
| `OPENCLAW_TZ`                           |        | `Asia/Seoul`                          | 컨테이너 시간대                                                                                                                                                                               |
| `OPENCLAW_NAS_ROOT`                     |        | (없음)                                | 부서 공유의 부모 경로. 비우면 샘플 트리를 마운트하고 부서 에이전트는 자기 워크스페이스를 쓴다 (11.4)                                                                                          |
| `OPENCLAW_KNOWLEDGE_ROOT`               |        | (없음)                                | 마크다운 사이드카 색인의 부모 경로. 비우면 부서 에이전트의 `extraPaths` 가 빈 목록이 된다 (12절, KNOWLEDGE.md)                                                                                |
| `ANTHROPIC_API_KEY`                     |        | (없음)                                | 외부 모델 API 키. 사내 ollama 만 쓰면 비워 둔다. 설정 파일에는 `"${ANTHROPIC_API_KEY}"` 이름만 적는다 (3.4)                                                                                   |
| `OPENAI_API_KEY`                        |        | (없음)                                | 위와 같다. 두 키 모두 비면 모델 목록이 비고 화면에 "사용 가능한 모델 없음" 이 뜬다                                                                                                            |

`gateway.auth.ixAuth.selfSignup` 도 **환경변수가 아니다.** `start-gateway.sh` 가 `IXAUTH_ACCOUNT_SIGNUP_MODE` 에서 유도한다(`OPEN`·`APPROVAL` 이면 가입 화면이 열린다). 두 곳을 손으로 맞추면 "가입 화면은 있는데 누르면 거부" 가 생긴다.

### 2.1 초대·가입 운영

| 하고 싶은 것        | 방법                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| 계정 하나 만들기    | 설정 -> 연결 -> 초대. 이메일·역할·부서를 넣고 발급                          |
| 초대 링크 전달      | SMTP 가 없으면 화면에 링크가 뜬다. 직접 전달하고 목록에서 삭제. 72시간 만료 |
| 자기 가입 열기      | `IXAUTH_ACCOUNT_SIGNUP_MODE=APPROVAL` + SMTP 설정 후 재기동                 |
| 가입 승인·거절      | 설정 -> 연결 -> 가입 승인                                                   |
| 도메인 제한         | `IXAUTH_ACCOUNT_SIGNUP_ALLOWED_DOMAINS`                                     |
| 메일 흐름 실물 확인 | `docker compose --profile mail ... up -d` 후 `http://127.0.0.1:18025`       |

상세는 [AUTH-SIGNUP.md](AUTH-SIGNUP.md).

`issuer` 와 `audience` 는 **환경변수가 아니다.** compose 와 게이트웨이[<sup>1</sup>](#g1) 설정 파일에 같은 리터럴(`openclaw-ix-auth` / `openclaw-gateway`)로 박아 두었다. 이 두 값을 양쪽에서 따로 맞추다 틀리는 것이 이 모드의 1번 함정이라 손댈 수 없게 한 것이다.

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
2. Flyway 마이그레이션 (`V1`~`V15`)
3. **역할 5종 시드** (`V14` 가 4종, `V15` 가 `EXECUTIVE`. `SUPERADMIN` 에는 `ixauth:*:*` 권한도 함께 준다)
4. 서명 키 생성 + **최초 관리자 1명 시드**(`SUPERADMIN` 부여)
5. 게이트웨이가 `ixauth-gateway-config/openclaw.json` 을 상태 볼륨에 렌더링하고 `--bind lan` 으로 기동

`http://<OPENCLAW_PUBLIC_ORIGIN>` 을 열면 로그인 화면이 뜬다. 토큰[<sup>2</sup>](#g2)도 기기 페어링도 없다.

> **`__Host-` 쿠키 주의.** 기본 쿠키 이름은 `__Host-` 접두라 `Secure` 를 요구하지만, 게이트웨이는 비보안 컨텍스트에서 접두사와 `Secure` 를 스스로 떼고 내리므로 평문 HTTP 사내망 IP 에서도 세션이 유지된다(근거와 대가는 11.2). 로컬 검증은 `http://127.0.0.1:18800` 으로 하고(`localhost` 는 다른 이름이라 오리진이 어긋난다), 실배포는 TLS 뒤에 두는 것을 권한다.

### 3.1 첫 로그인 직후 할 일 (운영 지시)

IX-Auth 에는 "첫 로그인 시 비밀번호 변경 강제" 기능이 **없다.** 통제 장치 없이 절차로 지킨다.

1. `IXAUTH_ADMIN_EMAIL` / `IXAUTH_ADMIN_PASSWORD` 로 로그인한다.
2. 신원 메뉴의 **사용자 관리**(`/settings/users`)로 들어간다. 앱 안에서 처리되므로 두 번째 로그인이 없다.
3. 관리자 비밀번호를 바꾼다.
4. 실제 사용자를 만든다. 역할은 `SUPERADMIN`·`ADMIN`·`EXECUTIVE`·`MEMBER` 중에서 고른다(`MODERATOR` 도 받지만 권하지 않는다).
5. `.env` 의 `IXAUTH_ADMIN_PASSWORD` 를 지운다. 첫 부팅에만 쓰이므로 이후에는 아무 효과가 없다.

### 3.2 사용자 추가

**앱 안의 설정 > 사용자**(`/settings/users`)에서 한다. 초대·CSV 가져오기·역할·부서·상태·잠금 해제·MFA 초기화·세션 강제 종료·삭제가 전부 그 화면에 있고, 두 번째 로그인이 없다. 전체 규칙과 한계는 [AUTH-USERS.md](AUTH-USERS.md).

IX-Auth 콘솔(`/admin/identity/`)은 **superadmin 에게만** "고급" 링크로 남는다. 콘솔은 자체 로그인을 유지하며(이중 방어, 의도한 동작), 앱 화면이 막는 계급 보호(자기 자신·마지막 시스템 관리자)를 콘솔은 적용하지 않는다. 역할·권한 정의를 손보는 것처럼 앱 화면에 없는 일에만 쓴다.

| 게이트웨이 역할 | 한국어 표기   | 세션 타인 열람 | 사용자 관리 화면 |
| --------------- | ------------- | -------------- | ---------------- |
| `superadmin`    | 시스템 관리자 | 쓰기           | 보인다           |
| `admin`         | 관리자        | 쓰기           | 보인다           |
| `executive`     | 임원          | 보기           | 안 보인다        |
| `moderator`     | 중재자        | 제안           | 안 보인다        |
| `member`        | 직원          | 보기           | 안 보인다        |

임원은 **전 부서를 읽기만** 한다. 그 열람은 역할이 아니라 모든 `dept-` 그룹 소속에서 나오므로,
초대 화면에서 역할을 임원으로 고르면 부서가 전체 체크된 채로 뜬다(해제 가능). 부서를 하나도
남기지 않으면 게이트웨이가 전 부서를 채운다. 자세한 규칙은 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 3절.

링크를 **응답 본문에 싣지 않는다.** 주소를 직접 입력해도 403 이다.

### 3.3 부서 운영

부서 경계는 **에이전트**에 그어진다. 세션은 그 에이전트의 워크스페이스·스킬·지식 안에서만 살기 때문이다. 전체 규칙과 되돌리기는 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md).

```bash
# 1) 콘솔(/admin/identity/)에서 그룹을 만든다. 코드는 dept-<slug> (예: dept-rnd)
#    그룹에 역할을 붙이지 마라 - 역할과 부서는 직교해야 한다

# 2) 그 부서 에이전트를 만들고 묶는다
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml   exec -u node gateway node openclaw.mjs agents department --agent rnd-bot --set rnd

# 3) 확인
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml   exec -u node gateway node openclaw.mjs agents department --json

# 4) 콘솔에서 사용자를 그룹 멤버로 넣는다. 포크 쪽에 할 일은 없다 -
#    그 사람의 다음 로그인이 부서 소속을 투영한다
```

| 알아 둘 것                      | 내용                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 어디에도 안 묶은 에이전트       | 공용이다. 부서가 있는 사람은 기존 규칙대로 쓰고, 미배정자는 자기 세션만 본다                                     |
| 부서 이동 반영                  | 그 사람의 **다음 로그인**. 즉시 반영하려면 콘솔에서 세션도 종료한다                                              |
| 에이전트 바인딩 변경 반영       | **즉시**. 재시작이 필요 없다                                                                                     |
| 남의 부서 세션을 키로 직접 열면 | **404**(없다). 403 이 아니다 - 키 존재 여부를 열거당하지 않기 위해서다                                           |
| 역할 부여 API                   | `PUT /admin/users/{id}/roles` 의 본문 필드는 `roles` 다. `codes` 로 보내면 서버가 오류 없이 기본 역할로 되돌린다 |

### 3.4 모델 프로바이더

기동 직후에는 **자격증명이 하나도 없다.** 정본 템플릿은 기본 모델(`agents.defaults.model.primary` = `openai/gpt-5.6-sol`)과 그 모델이 요구하는 codex 런타임(`plugins.entries.codex.enabled`)만 켜 두고, 키도 계정도 담지 않는다. 아래 셋 중 하나를 고른다.

정본 설정 파일은 `chris-local/ixauth-gateway-config/openclaw.json` 이고, 매 기동마다 상태 볼륨에 덮어쓴다(5절). 모델 설정도 이 파일에 넣는다.

**시크릿 값은 이 파일에 절대 쓰지 않는다.** 게이트웨이가 `"${환경변수이름}"` 형태의 env SecretRef 를 해석하므로, 값은 `.env` 에만 두고 파일에는 이름만 적는다. `IXAUTH_SERVICE_KEY` 가 쓰는 것과 같은 장치다.

#### (가) 외부 API 방식

`.env` 에 키를 넣고, compose 가 그 이름 그대로 게이트웨이 컨테이너에 넘긴다.

`ixauth-gateway-config/openclaw.json` 에 넣는다 (`agents` 는 이미 있으니 `defaults` 만 더한다).

```json
{
  "models": {
    "providers": {
      "anthropic": {
        "baseUrl": "https://api.anthropic.com",
        "apiKey": "${ANTHROPIC_API_KEY}"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-5"
    }
  }
}
```

`ANTHROPIC_API_KEY`·`OPENAI_API_KEY` 는 게이트웨이가 **환경변수 이름 그대로도 읽는다**(프로바이더 기본 자격증명 조회). 그래서 `.env` 에 값만 채워도 동작하고, 위처럼 SecretRef 로 적는 것은 "이 배포가 어떤 키를 쓰는지" 를 설정 파일에 남기기 위해서다. 어느 쪽이든 값은 `.env` 에만 있다.

> 외부 API 는 사내 자료가 회사 밖으로 나간다. 부서 기밀 요건이 있으면 (나) 를 쓴다.

#### (나) 사내 ollama 방식

모델과 임베딩[<sup>3</sup>](#g3)을 전부 사내에서 끝낸다. compose 에 서비스를 하나 더 붙인다.

```yaml
# docker-compose.ixauth.yml 의 services: 아래
ollama:
  image: ollama/ollama:latest
  restart: unless-stopped
  volumes:
    - ollama-models:/root/.ollama
  # 포트를 열지 않는다. 게이트웨이만 내부망으로 붙는다.
  networks: [ix-auth-internal]

# volumes: 아래
ollama-models:
```

게이트웨이 설정:

```json
{
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "http://ollama:11434",
        "api": "ollama"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "ollama/qwen4:32b"
    }
  },
  "memory": {
    "search": {
      "provider": "ollama",
      "model": "bge-m3",
      "remote": { "baseUrl": "http://ollama:11434" }
    }
  }
}
```

- `baseUrl` 에 **`/v1` 을 붙이지 마라.** OpenAI 호환 경로는 도구 호출[<sup>4</sup>](#g4)을 깨뜨려서 모델이 도구 호출 JSON 을 본문에 그대로 뱉는다.
- 루프백·사설망·컨테이너 이름 주소는 토큰이 필요 없다. 게이트웨이가 `ollama-local` 표식을 쓴다.
- 모델은 미리 받아 둔다: `docker compose ... exec ollama ollama pull qwen4:32b`, 임베딩은 `ollama pull bge-m3`.
- 임베딩 모델을 바꾸면 색인 정체성이 달라진다. 반드시 3.5 의 재색인을 돌린다.
- GPU 가 있으면 compose 서비스에 `deploy.resources.reservations.devices` 로 넘긴다. 없으면 CPU 로도 뜨지만 응답이 느리다.

#### (다) ChatGPT 구독(Codex OAuth) 방식

API 키를 따로 사지 않고, 이미 있는 ChatGPT 유료 구독 계정으로 붙인다. 자격증명이 OAuth 프로필이라 `.env` 에도 설정 파일에도 쓰지 않는다. 상태 볼륨의 인증 저장소(`/home/node/.openclaw/state/openclaw.sqlite`)에 들어가고, 컨테이너를 다시 만들어도 볼륨이 살아 있는 한 유지된다.

정본 템플릿에는 이 방식에 필요한 두 키가 이미 들어 있다. 그래서 로그인만 하면 되고, 설정을 고칠 일이 없다.

```json
{
  "plugins": { "entries": { "codex": { "enabled": true } } },
  "agents": { "defaults": { "model": { "primary": "openai/gpt-5.6-sol" } } }
}
```

`openai/gpt-5.6-sol` 은 codex 하니스가 실행하는 모델이고, 그 하니스를 소유한 플러그인이 **설정에서 명시적으로 켜져 있어야** 런타임으로 인정된다. 이 키가 없으면 로그인을 해 두어도 `models status` 가 `runtime=unavailable | No enabled plugin owns agent harness "codex"` 로 답한다.

**로그인 절차.** 브라우저 리디렉션이 없는 device-code 흐름을 쓴다. 로그인 명령은 대화형이라 TTY 가 필요하므로 `script` 로 감싸 배경에서 띄우고, 승인 주소와 코드는 로그에서 읽는다.

```bash
# 1) 로그인 명령을 배경에서 띄운다 (출력은 /tmp/openai-login.log 로 흘린다)
docker exec -d openclaw-ixauth-gateway-1 sh -c \
  "script -q -f -c 'openclaw models auth login --provider openai --device-code --agent main' /tmp/openai-login.log"

# 2) 승인 주소와 코드를 읽는다 (몇 초 뒤에 찍힌다)
docker exec openclaw-ixauth-gateway-1 cat /tmp/openai-login.log
```

로그에 나오는 주소(`https://auth.openai.com/codex/device`)를 브라우저에서 열고, 같은 로그에 찍힌 코드를 넣은 뒤 구독 계정으로 승인한다. 승인이 끝나면 로그가 프로필 생성(`openai:<계정메일>`)으로 끝난다.

**첫 로그인은 codex 런타임 패키지도 같이 내려받는다.** 납품 이미지는 이 플러그인을 담고 있지 않고, 로그인 명령이 상태 볼륨(`/home/node/.openclaw/npm/projects/`)에 설치한다. 그러니 첫 로그인 뒤에는 게이트웨이를 한 번 다시 띄워야 실행 중인 프로세스가 새 플러그인을 잡는다. 두 번째부터는 볼륨에 이미 있으므로 재기동만으로 끝난다.

```bash
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml \
  restart gateway
```

> **함정.** `openclaw doctor --fix` 로 고치려 들지 마라. 게이트웨이가 도는 컨테이너에서 돌릴 수 있는 수리가 아니다. doctor 는 대화형 확인을 거는 흐름이라 TTY 없는 `docker exec` 에서 그대로 서고, 끝까지 돌더라도 doctor 가 고친 `openclaw.json` 은 다음 기동 때 `start-gateway.sh` 의 템플릿 렌더에 덮여 사라진다. 덮인 사본이 상태 볼륨에 `openclaw.json.clobbered.<시각>` 으로 남는 것이 그 증거다. 이 스택에서 설정을 바꾸는 길은 템플릿 파일 하나뿐이다(5절).

**확인.**

```bash
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml \
  exec -u node gateway node openclaw.mjs models status --agent main
```

`Runtime auth` 줄이 `openai via codex ... status=usable` 이면 끝난 것이다. `runtime=unavailable` 이면 템플릿의 `plugins.entries.codex.enabled` 가 렌더된 설정에 들어갔는지부터 본다.

> 구독 계정 하나를 여러 사용자가 공유하는 셈이므로 사용량 한도가 계정 단위로 걸린다. `models status` 의 `OAuth/token status` 줄이 남은 5시간·주간 한도를 알려 준다.

> **부서 에이전트는 이 방식으로 쓰지 마라.** 이 경로의 모델은 codex 하네스에서 돌고, 그 하네스는 파일을 자기 셸로 읽는다. 셸의 읽기 전용 샌드박스는 "쓰기 금지"일 뿐 파일시스템 전체가 읽히므로, `tools.fs.workspaceOnly` 로 선언한 폴더 경계가 서지 않는다(다른 부서 마운트도 읽힌다). 근거와 실측은 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 13.9 다. 부서 에이전트에는 (가) 외부 API 방식의 자격증명을 준다. 설정에 그 조합이 남아 있으면 `openclaw doctor --lint --only codex/agent-workspace-boundary` 가 경고한다.

#### (라) 배포 후 부서 에이전트 키 세팅 순서

사용자 결정(2026-09-08): **API 키는 배포 시점에 넣는다.** 그때까지 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY` 는 둘 다 비어 있고, `main` 은 (다) 의 구독 프로필로 답하고 `rnd-bot`·`qa-bot` 은 모델이 없어 답하지 못한다. 다른 기능은 이 상태에서도 전부 동작한다.

키가 생기면 아래 순서로 한다. 둘 중 **한 쪽만** 채우면 된다.

1. **키를 `.env` 에 넣는다.** `chris-local/ixauth.env` 의 `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY`. compose 가 같은 이름으로 게이트웨이 컨테이너에 넘긴다.

2. **정본 템플릿에 프로바이더와 부서 에이전트 모델을 적는다.** 파일은 `chris-local/ixauth-gateway-config/openclaw.json` 이고, 값이 아니라 이름만 적는다((가) 의 SecretRef).

   ```json
   {
     "models": {
       "providers": {
         "anthropic": { "baseUrl": "https://api.anthropic.com", "apiKey": "${ANTHROPIC_API_KEY}" }
       }
     },
     "agents": {
       "entries": {
         "rnd-bot": { "model": "anthropic/claude-sonnet-5" },
         "qa-bot": { "model": "anthropic/claude-sonnet-5" }
       }
     }
   }
   ```

   `main` 은 손대지 않는다. 그러면 `agents.defaults.model.primary` 를 그대로 써서 구독 경로로 계속 답한다.

   **화면에서는 모델을 바꿀 수 없다.** 설정 > 부서 관리(`/settings/departments`)가 쓰는 `config.patch` 는 워크스페이스·읽기 전용 여부·색인 폴더만 건드린다(`ui/src/pages/departments/departments-gateway.ts`). 그리고 `start-gateway.sh` 가 매 기동마다 템플릿으로 상태 설정을 덮으므로, 화면이나 CLI 로 넣은 설정은 다음 재기동에 사라진다. 모델은 템플릿에 적어야 남는다.

3. **재기동한다.** 템플릿만 바뀌었으면 이미지를 다시 빌드할 필요가 없다. 설정 디렉터리는 읽기 전용 바인드 마운트라 파일이 그대로 보인다.

   ```bash
   docker compose --env-file chris-local/ixauth.env \
     -f chris-local/docker-compose.ixauth.yml up -d gateway
   ```

4. **확인한다.** 위에서 아래로 하나씩 본다. 앞 단계가 안 되면 뒤는 볼 필요가 없다.

   | 순서 | 확인                                                 | 어디서                                                                      |
   | ---- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
   | 1    | 모델 목록에 새 모델이 보인다                         | 위 "확인" 의 `models list`                                                  |
   | 2    | 부서 색인이 최신이다                                 | `knowledge sync`(12절) 후 `memory index --force --agent rnd-bot`(3.5)       |
   | 3    | rnd-bot 이 폴더 문서를 요약하고 **원본 경로**를 낸다 | 로그인 후 rnd-bot 세션에서 질문. 인용 규칙은 [KNOWLEDGE.md](KNOWLEDGE.md)   |
   | 4    | qa-bot 에게 R&D 자료를 물으면 못 찾는다              | 같은 질문을 qa-bot 에게. 부서 경계는 마운트와 워크스페이스가 만든다         |
   | 5    | 쓰기 요청이 거부된다                                 | rnd-bot 에게 파일 수정을 시킨다. 공유는 `:ro` 이고 도구 프로필은 `readonly` |
   | 6    | 경계 경고가 없다                                     | `openclaw doctor --lint --only codex/agent-workspace-boundary`              |

   근거와 배경은 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 3-1절과 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 13.9.

#### (마) 구독 로그인 파일로 main 인증을 넣는다 (키 없이 바로 답하게 하기)

(다) 를 컨테이너 안에서 대화형으로 돌리기 어려운 배포(NAS 등)에서는, **이미 로그인한 PC 의 Codex CLI 로그인 파일 하나**를 옮기는 것으로 같은 결과를 얻는다. 게이트웨이는 그 파일을 읽어 ChatGPT 구독 OAuth 프로필 `openai:default` 을 만든다.

| 항목          | 값                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| 원본          | 로그인한 PC 의 `~/.codex/auth.json`                                                                          |
| 컨테이너 경로 | `/home/node/.openclaw/codex-cli/auth.json` (상태 볼륨 안)                                                    |
| 호스트 경로   | `<볼륨>/_data/codex-cli/auth.json` (NAS: `/volume1/@docker/volumes/openclaw-ixauth_gateway-state/_data/...`) |
| 소유자·권한   | 컨테이너의 `node` 사용자(uid 1000), `0600`                                                                   |
| 읽는 코드     | `src/agents/cli-credentials.ts` 의 `resolveCodexCliHomePath` → `CODEX_HOME` 없으면 `~/.codex`                |

**왜 `~/.codex` 가 아니라 볼륨 안인가.** `~/.codex` 는 상태 볼륨 밖이라 다음 배포에서 컨테이너가 새로 만들어지면 사라진다. 그래서 compose 의 게이트웨이 환경에 `CODEX_HOME: /home/node/.openclaw/codex-cli` 를 박아 두었다. 이 값은 codex 하네스와 충돌하지 않는다: 하네스는 `appServer.homeScope` 기본값 `agent` 로 `<agentDir>/codex-home` 을 따로 쓰고, 실행 전에 주변 `CODEX_HOME` 을 걸러낸다.

```bash
# 값이 로그·프로세스 목록에 남지 않도록 표준입력으로만 넣는다. docker cp 는 root 소유가 돼서 안 된다.
cat ~/.codex/auth.json | docker exec -i -u node openclaw-ixauth-gateway-1   sh -c 'umask 077; mkdir -p /home/node/.openclaw/codex-cli; cat > /home/node/.openclaw/codex-cli/auth.json'

# 확인
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml   exec -u node gateway node openclaw.mjs models status --agent main
# -> openai:default = OAuth, status=usable
```

**이 파일은 부트스트랩일 뿐이다.** codex 외부 CLI 공급자는 `bootstrapOnly` 라 처음 읽은 자격증명이 **runtime-only** 로만 얹힌다(`src/agents/auth-profiles/external-cli-sync.ts`). 게이트웨이가 토큰을 한 번 갱신하고 나면 갱신본은 상태 볼륨 안 인증 프로필 저장소에 **영구 저장**되고(`shouldPersistRuntimeExternalOAuthProfile`), 그 뒤로는 저장본이 이 파일보다 우선한다. 게이트웨이는 `auth.json` 을 **읽기만 하고 되쓰지 않으므로** 파일 쪽 refresh 토큰은 시간이 지나면 낡는다. 저장본이 살아 있는 동안에는 문제가 없고, 저장본까지 못 쓰게 되면 낡은 파일로는 복구되지 않으니 그때는 PC 에서 `codex login` 을 다시 하고 파일을 갈아끼운다.

**한계 두 가지.**

- **부서 봇에는 못 쓴다.** 구독 런타임에서는 폴더 경계가 지켜지지 않는다(AUTH-DEPARTMENTS 13.9). `rnd-bot`·`qa-bot` 은 (라) 의 API 키가 필요하다. 이 방식은 부서에 묶이지 않은 `main` 전용이다.
- **같은 로그인을 두 곳에서 쓰지 않는다.** 같은 파일을 원래 PC 와 서버가 동시에 쓰면 한쪽의 갱신이 다른 쪽의 refresh 토큰을 무효화할 수 있다. 서버로 옮겼으면 그 로그인은 서버 것으로 본다.

#### 확인

```bash
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml \
  exec -u node gateway node openclaw.mjs models list
```

### 3.5 한국어 검색 재색인

납품 설정은 FTS 토크나이저를 `trigram` 으로 둔다(`memory.search.store.fts.tokenizer`). 기본값 `unicode61` 은 한국어를 공백 단위로만 끊어서 "결재규정" 같은 붙은 말이 검색되지 않는다.

토크나이저나 임베딩 모델을 바꾼 뒤에는 **기존 색인이 새 설정과 맞지 않으므로 다시 만들어야 한다.** 에이전트마다 따로 돈다.

```bash
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml \
  exec -u node gateway node openclaw.mjs memory index --force --agent main
```

- `--agent` 를 빼면 전 에이전트를 돈다. 부서 에이전트가 여러 개면 시간이 오래 걸리므로 하나씩 도는 편이 낫다.
- 진행 상황은 `memory status --agent <id>` 로 본다. 색인 정체성 경고가 남아 있으면 아직 옛 설정으로 만든 행이 있다는 뜻이다.
- 재색인은 대화 이력을 지우지 않는다. 파생 색인만 다시 만든다.

### 3.6 문서 미리보기 변환기

게이트웨이 이미지 빌드 인자 `OPENCLAW_IMAGE_APT_PACKAGES` 에 LibreOffice 3종과 `fonts-nanum` 이 들어 있다(2026-09-07 반영). 이것이 있어야 docx·xlsx·pptx 가 PDF 로 변환돼 미리보기가 뜬다. 없으면 PDF 만 정상이고 docx·xlsx 는 이미지 없는 HTML 폴백, pptx·doc·xls·ppt 는 실패한다.

| 항목        | 값                                                                                    |
| ----------- | ------------------------------------------------------------------------------------- |
| 이미지 증가 | 약 **+580 MiB** (실측 `chris-local/FILE-PREVIEW.md` 6절)                              |
| 대상 확장자 | pdf, docx, xlsx, pptx, doc, xls, ppt                                                  |
| 제외        | hwp·hwpx (사용자 확정 범위 밖. 화면에 안내문이 뜬다)                                  |
| 폰트        | `fonts-noto-cjk` 계열 + `fonts-nanum`. 폰트가 없어도 변환은 종료코드 0 을 내므로 주의 |

디스크가 빠듯해 변환기를 빼야 하면 빌드 인자에서 `libreoffice-*` 세 개만 지운다. 폰트는 PDF 생성에도 쓰이므로 남긴다.

### 3.7 감사 원장

사람 단위 활동 기록은 **기본으로 켜져 있다**. 정본은 [AUTH-AUDIT.md](AUTH-AUDIT.md). 배포가 정해야 하는 값은 셋뿐이다.

> **납품 기본값은 사용자 확정값이다(2026-09-08): 보존기간 90일, 질문 본문 미기록(`promptText: false`).** 아래 표의 기본값과 같으므로 설정을 바꿀 것은 없다. 계약 문구에도 같은 90일을 적는다.

```jsonc
{
  "logging": {
    "audit": {
      "enabled": true,
      "userActivity": {
        "promptText": false,
        "retentionDays": 90,
        "maxRows": 1000000,
      },
    },
  },
}
```

| 키              | 기본값    | 정할 때 생각할 것                                                                                            |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `promptText`    | `false`   | `true` 로 켜면 **사용자가 쓴 질문 본문**이 원장에 들어간다. 끄면 길이와 해시만. 고객 내부 규정에 따라 정한다 |
| `retentionDays` | `90`      | 계약 문구와 같은 값이어야 한다(AUTH-AUDIT 8절)                                                               |
| `maxRows`       | `1000000` | 상한을 넘으면 오래된 행부터 지운다. 100만 행은 대략 수백 MiB. NAS 디스크가 작으면 줄인다                     |
| `enabled`       | `true`    | 이것을 끄면 사람 원장도 함께 꺼진다. 정리(보존기간 적용)는 꺼져 있어도 계속 돈다                             |

확인:

```bash
docker exec -it openclaw-gateway openclaw audit users --limit 5
```

관리자 화면은 **설정 > 개인정보 보호 & 보안 > 감사 기록**, CSV 는 그 화면의 내려받기 버튼이다. 원장은 보존기간 내 조회용이고 변조 방지가 없다 - 장기 보존이 요건이면 고객사 SIEM 내보내기를 정본으로 계약에 적는다.

### 3.8 배포 후 메일(SMTP) 세팅

사용자 결정(2026-09-08): **메일 서버도 배포 시점에 붙인다.** 그때까지는 `IXAUTH_MAIL_TRANSPORT=WEBHOOK` 으로 두고, 초대 링크는 화면에 뜨는 것을 관리자가 직접 전달한다(2.1). 이 상태에서 못 하는 것은 비밀번호 재설정 메일과 자체 가입 두 가지뿐이다.

고객 메일 서버 정보가 오면 아래 순서로 한다.

1. `chris-local/ixauth.env` 를 채운다.

   ```bash
   IXAUTH_MAIL_TRANSPORT=SMTP
   IXAUTH_MAIL_SMTP_HOST=<메일 서버>
   IXAUTH_MAIL_SMTP_PORT=587
   IXAUTH_MAIL_SMTP_USERNAME=<계정>      # 인증이 없으면 비운다
   IXAUTH_MAIL_SMTP_PASSWORD=<비밀번호>
   IXAUTH_MAIL_SMTP_STARTTLS=true
   IXAUTH_MAIL_FROM=<발신 주소>          # 그 서버가 발신을 허용하는 주소여야 한다
   IXAUTH_MAIL_PRODUCT_NAME=<제품명>     # 메일 제목·본문에 쓰인다
   ```

2. 신원 서버를 다시 띄운다. 메일 설정은 기동 시점에 읽는다.

   ```bash
   docker compose --env-file chris-local/ixauth.env \
     -f chris-local/docker-compose.ixauth.yml up -d ix-auth
   ```

3. 초대를 한 통 발급해 실제로 도착하는지 본다(설정 > 연결 > 초대). 도착하면 화면에는 링크가 더 이상 보관되지 않는다.

4. 개발용 수신함을 쓰고 있었으면 내린다. `--profile mail` 을 빼고 `up -d` 하면 mailpit 컨테이너가 사라진다. 18025 포트도 함께 닫힌다.

5. 메일이 살아난 뒤에야 자체 가입을 열 수 있다. `IXAUTH_ACCOUNT_SIGNUP_MODE=APPROVAL` 로 바꾸고 다시 기동하면 게이트웨이의 가입 화면도 함께 열린다(두 값은 한 변수에서 유도된다, 2절).

메일이 안 나갈 때 보는 곳은 `docker compose ... logs ix-auth` 다. 인증 실패·STARTTLS 거부·발신 주소 거부가 그대로 찍힌다.

## 4. 백업 · 복구

볼륨 2개가 상태의 전부다.

| 볼륨                              | 담는 것                                                                                                   | 잃으면                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `openclaw-ixauth_ix-auth-db-data` | 계정·역할·세션·감사 원장·서명 키                                                                          | 계정을 전부 다시 만든다                                                                 |
| `openclaw-ixauth_gateway-state`   | 게이트웨이 SQLite(프로필·로그인 세션·부서·대화·첨부 소유권), 워크스페이스, `media/inbound` 채팅 첨부 원본 | 대화 이력·로그인 세션·**에이전트 부서 바인딩**과 **사용자가 올린 첨부 파일**이 사라진다 |

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

**채팅 첨부 보존**: 사용자가 채팅에 올린 파일은 `media/inbound/` 에 **무기한** 남는다. 재참조 도구(`media_list`·`media_read`, [FILE-PREVIEW.md](FILE-PREVIEW.md) 8절)가 나중에도 열 수 있어야 한다는 요구 때문이며, 그래서 납품 템플릿에 `attachments.ttlHours` 를 **넣지 않는다.** 세션을 지워도 파일은 지우지 않고 공용 DB `inbound_media` 행에 삭제 표시만 남는다(감사 원장 보존 90일과 짝을 맞춘다). 사용량은 이렇게 본다.

```bash
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml   exec gateway du -sh /home/node/.openclaw/media/inbound
```

정리가 필요해지면 `attachments.ttlHours` 를 템플릿에 넣고 재기동한다. 그 시점부터 지난 첨부는 사라지고 재참조도 불가능해지므로, 넣기 전에 고객과 합의한다.

`IXAUTH_SERVICE_KEY` 를 바꾸면 등록된 TOTP 가 전부 무효가 된다(서버가 MFA 암호화 키를 이 값에서 파생한다). 키 회전은 2단계 인증 재등록 안내와 함께 한다.

### 4.1 납품 전 초기화

시연과 예행연습이 남긴 것을 걷어내는 절차다. 두 갈래가 있고, 고르는 기준은 하나다.\
**계정을 다시 만들 수 있으면 볼륨을 새로 만들고, 그럴 수 없으면 골라서 지운다.**

> **사용자 결정(2026-09-08): 시험 계정 8개는 이 PC 의 로컬 스택에는 그대로 두고, 납품용 스택을 세울 때 이 절차로 정리해 관리자 계정만 남긴다.** 로컬 검증 스택에는 아무 조작도 하지 않는다.

#### (가) 볼륨 재생성 - 가장 확실하다

계정·역할·감사 원장·대화가 전부 사라지고 첫 기동 직후 상태로 돌아간다. 관리자 계정은
`ixauth.env` 의 `IXAUTH_ADMIN_EMAIL`·`IXAUTH_ADMIN_PASSWORD` 로 다시 만들어진다.

```bash
cd <저장소 루트>
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml down -v
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml up -d
```

- `down -v` 는 두 볼륨을 **모두** 지운다. 남길 것이 하나라도 있으면 4절 백업을 먼저 뜬다.
- NAS 마운트와 색인 폴더는 호스트 경로에 있어 그대로 남는다. 색인은 12절 절차로
  다시 만든다.
- 서명 키가 새로 생기므로 열려 있던 탭은 전부 로그인 화면으로 떨어진다. 정상이다.

#### (나) 골라서 지우기 - 계정을 살려야 할 때

`chris-local/reset-seed.sh` 가 관리자로 로그인해 화면과 같은 경로로 지운다. 인자가 없으면
무엇을 지울지 보여 주기만 하고, `--yes` 를 줘야 실제로 지운다.

```bash
# 무엇이 남아 있는지 본다 (아무것도 바꾸지 않는다)
chris-local/reset-seed.sh --sessions --accounts disable --audit --invites

# 시연 대화만 지운다
chris-local/reset-seed.sh --session-key 'agent:main:dashboard:<세션 id>' --yes

# 시험 계정을 잠그고, 초대 링크와 활동 원장을 비운다
chris-local/reset-seed.sh --accounts disable --invites --audit --yes
```

| 단계                 | 무엇을 쓰나                                        | 되돌릴 수 있나                    |
| -------------------- | -------------------------------------------------- | --------------------------------- |
| `--sessions`         | 게이트웨이 세션 삭제 RPC(화면의 삭제와 같은 경로)  | 아니다. 전사는 보관본으로 남는다  |
| `--accounts disable` | 계정 상태를 DISABLED 로 (`/auth/admin/users/{id}`) | 그렇다. 화면에서 다시 활성화한다  |
| `--accounts delete`  | 계정 삭제                                          | 아니다                            |
| `--invites`          | 남아 있는 초대 링크를 잊는다                       | 아니다. 초대는 다시 발급하면 된다 |
| `--audit`            | 활동 원장 비우기                                   | 아니다                            |

- **활동 원장에는 비우는 화면이 없다.** 감사 기록을 화면에서 지울 수 있으면 감사가 아니기
  때문이다. 납품 직전 초기화만 정당한 순간이라 이 스크립트에만 있고, 상태 DB 를 직접 지운다.
- 삭제해도 활동 원장과 전사 보관본(`session_transcript_archives`)은 남는다. 대화 창과 실행
  상태만 사라진다. 전사까지 지우려면 (가) 로 간다.
- 세션 키는 설정 > 세션 목록에서 얻는다.
  에이전트의 main 세션은 게이트웨이가 삭제를 거부하므로 목록에 넣지 않는다.
- 이 스크립트는 ix-auth 모드에서 CLI 가 자기 게이트웨이 RPC 에 인증할 수 없다는 제약을 우회
  하려고, 관리자 로그인 쿠키를 그대로 한 번의 핸드셰이크에 실어 보낸다. 근거와 코드는
  `chris-local/reset-seed-rpc.mjs` 주석에 있다.

#### (다) 관리자 계정만 남기기

납품 스택에서 하는 것은 이것이다. 지우는 대상은 스크립트의 `TEST_ACCOUNTS` 목록에 이름으로
적혀 있고, 그 목록에 없는 계정은 손대지 않는다.

```bash
# 먼저 무엇이 지워질지 본다
chris-local/reset-seed.sh --accounts delete --invites --audit

# 확인했으면 실행한다
chris-local/reset-seed.sh --accounts delete --invites --audit --yes
```

| 구분   | 계정                                                                                                | 결과                        |
| ------ | --------------------------------------------------------------------------------------------------- | --------------------------- |
| 지운다 | `solo` `nobody` `nobody-1` `nobody-2` `newjoiner` `invitee` `qamem` `mod` `member` `admin2` `exec1` | 목록에서 사라진다           |
| 남긴다 | `.env` 의 `IXAUTH_ADMIN_EMAIL` (SUPERADMIN 시드 계정)                                               | 이 계정으로 인수인계한다    |
| 남긴다 | 고객이 직접 만든 계정                                                                               | 이름이 목록에 없으므로 안전 |

실행 뒤 `/settings/users` 를 열어 남은 계정이 관리자 하나뿐인지 눈으로 본다. 목록에 없던 시험
계정을 더 만들었으면 `--account <이름>` 으로 한 건씩 지운다.

관리자 비밀번호는 인수인계 전에 바꾼다(3.1). `.env` 에 적힌 초기 비밀번호는 그 파일을 본 사람이
모두 아는 값이다.

### 4.2 납품 배포 체크리스트

기능 결정은 2026-09-08 에 전부 끝났다. 배포 시점에 값만 넣으면 되는 것이 아래 네 가지이고,
각 항목의 절차는 옆 칸의 절이 정본이다.

| #   | 넣을 것            | 절차                                         | 안 넣으면                                                              |
| --- | ------------------ | -------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | 모델 API 키 한 개  | 3.4 (라)                                     | `main` 은 구독으로 답하고 부서 에이전트는 답하지 못한다                |
| 2   | 고객 SMTP 자격증명 | 3.8                                          | 초대 링크를 관리자가 손으로 전달한다. 비밀번호 재설정 메일이 안 나간다 |
| 3   | 제품명             | FORK.md 5-1 (`src/brand.ts` 의 `BRAND_NAME`) | 임시값 "Chris Agent" 가 화면과 메일에 그대로 나온다                    |
| 4   | 약관 문안          | 고객 제공                                    | 가입·초대 화면에 약관 링크가 없다                                      |

같이 하는 것: 시험 계정 정리(4.1 (다)), 도메인·터널 확인(11.7), 백업 1회(4절).

## 5. 업그레이드

```bash
git pull
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml build
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml up -d
```

- 볼륨은 유지된다. Flyway 가 새 마이그레이션만 적용한다.
- 게이트웨이 설정은 `ixauth-gateway-config/openclaw.json` 이 정본이고 **매 기동마다 상태 볼륨에 덮어쓴다.** 설정을 바꾸려면 이 파일을 고친다. 컨테이너 안에서 고친 것은 다음 기동에 사라진다.
- 업그레이드 전에 4절 백업을 먼저 뜬다.

## 6. 되돌리기

| 상황                        | 조치                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 이번 이미지가 문제          | 이전 이미지 태그로 `docker compose up -d` (빌드본이면 4절 백업 복구가 더 확실하다)                           |
| 로그인 모드 자체를 되돌린다 | [AUTH-IXAUTH.md](AUTH-IXAUTH.md) 8절. `ix_auth_login_sessions` 를 DROP 하지 않고 IX-Auth DB 도 지우지 않는다 |
| 급히 전원을 끊어야 한다     | `docker compose stop gateway`. DB 와 신원 서버는 살려 둔다                                                   |

## 7. 포트 · 방화벽

| 대상       | 포트                               | 노출                                           |
| ---------- | ---------------------------------- | ---------------------------------------------- |
| 게이트웨이 | 호스트 `18800` -> 컨테이너 `18789` | **여는 유일한 포트**                           |
| IX-Auth    | 컨테이너 `9100`                    | compose 내부망만. `ports` 없음 (설계 불변식 4) |
| PostgreSQL | 컨테이너 `5432`                    | compose 내부망만                               |

- 운영에서는 18800 을 리버스 프록시(TLS 종단) 뒤에 두고, 호스트 방화벽에서 18800 을 프록시 주소로만 연다.
- Docker 는 `iptables` 를 직접 만지므로 `ufw` 규칙이 컨테이너 포트에 먹지 않는다. `DOCKER-USER` 체인에 넣거나 `ports` 를 `127.0.0.1:18800:18789` 로 바꿔 프록시가 같은 호스트에서만 붙게 한다.
- 게이트웨이는 컨테이너 안에서 `0.0.0.0` 에 바인드한다. 루프백 바인드로는 브리지 네트워크의 `-p` 가 닿지 않기 때문이고, 그래도 안전한 이유는 `gateway.auth.mode` 가 `ix-auth` 라 인증 없는 표면이 없어서다.
- **Cloudflare Tunnel 프로파일(11.7)을 쓰면 인바운드로 여는 포트가 하나도 없다.** cloudflared 가 Cloudflare 로 나가는 연결을 자기가 열고 그 위로 요청을 받으므로, 공유기 포트포워딩도 공인 IP 도 필요 없다. 방화벽에는 아웃바운드 443/tcp(및 QUIC 을 쓰면 7844/udp) 만 있으면 된다. 호스트 18800 은 그때 로컬 점검용으로만 남으므로 `ports` 를 `127.0.0.1:18800:18789` 로 좁히는 편이 낫다.

## 8. 라이선스 확인 항목 (납품 전 법무 확인 필요)

| 대상                                    | 라이선스                       | 상태                                                                               |
| --------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| **IX-Auth** (`ix-auth/`)                | `package.json` 이 `UNLICENSED` | **해결.** 자사 제품이라 동봉·재배포에 제약이 없음을 사용자가 확인했다 (2026-09-08) |
| 게이트웨이                              | MIT                            | 문제 없음                                                                          |
| `postgres:16-alpine`                    | PostgreSQL License (BSD 계열)  | 문제 없음                                                                          |
| Chromium (`OPENCLAW_INSTALL_BROWSER=1`) | BSD 계열 + 다수                | 고지 의무 확인                                                                     |
| Noto CJK 폰트                           | SIL OFL 1.1                    | 재배포 시 라이선스 동봉                                                            |

**IX-Auth 는 자사 제품이다.** `package.json` 의 `UNLICENSED` 표기는 공개 npm 배포를 막는 표시일 뿐이고, 자사 제품을 자사 납품물에 동봉하는 데는 제약이 없다는 것을 사용자가 2026-09-08 에 확인했다. 남은 것은 문서 정리뿐이다.

- 고객이 받는 범위(사용권인지 소스 포함인지)는 납품 계약서에 적는다.
- 벤더 복사본의 출처와 재동기화 절차는 [ix-auth/VENDOR.md](../ix-auth/VENDOR.md) 에 있다.

## 9. 진단

| 증상                                           | 확인                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `up -d` 후 게이트웨이가 계속 재시작한다        | `docker compose ... logs gateway`. 설정 오류면 `Gateway start blocked:` 로 시작하는 줄이 이유를 말한다    |
| 로그인 폼에서 403 `origin_not_allowed`         | `OPENCLAW_PUBLIC_ORIGIN` 이 브라우저 주소창의 오리진과 글자 그대로 같은지. 다시 기동해야 반영된다         |
| 로그인 200 인데 바로 로그아웃된다              | issuer/audience 불일치. 이 스택에서는 양쪽에 박혀 있으므로, 설정 파일을 손댔다면 되돌린다                 |
| 쿠키가 아예 저장되지 않는다                    | 프록시 뒤인데 `gateway.trustedProxies` 가 비어 있거나, 반대로 `Secure` 가 붙었는데 평문이다 (11.2·11.3)   |
| 로그인은 되는데 "승인되지 않은 기기" 로 끊긴다 | 이 모드는 기기 페어링을 요구하지 않는다. 이 메시지가 보이면 이미지가 구버전이다                           |
| 사용자 관리가 403                              | 그 계정의 역할이 `superadmin`·`admin` 이 아니다. 설정 > 사용자 에서 역할을 바꾼다(세션은 자동으로 끊긴다) |
| 콘솔에서 저장이 403 `csrf_mismatch`            | 게이트웨이 세션이 만료됐다. Control UI 탭을 새로 고쳐 로그인한 뒤 콘솔을 다시 연다                        |
| 신원 서버가 뜨지 않는다                        | `IXAUTH_SERVICE_KEY` 가 32자 미만이면 부팅을 거부한다                                                     |
| 나머지                                         | [AUTH-IXAUTH.md](AUTH-IXAUTH.md) 7.4                                                                      |

### 9.1 컨테이너 안 CLI 로 무엇이 되는가

이 모드에는 공유 시크릿이 없다. 그래서 컨테이너 안의 `openclaw` 는 **자기 게이트웨이 RPC 에
인증하지 못한다**(로그에 `reason=gateway_auth_required`). 호스트 셸을 여는 것은 이 납품의
경계 밖이므로 "호스트에서 하라" 는 답이 되지 않는다. 명령마다 사정이 다르다.

| 명령                                                                                                   | 컨테이너 안에서                                                                  |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `openclaw audit users`                                                                                 | **된다.** RPC 가 막히면 상태 SQLite 를 직접 읽고 첫 줄에 `Local read:` 를 찍는다 |
| `openclaw knowledge sync`                                                                              | **된다.** 처음부터 게이트웨이를 타지 않는다 (12절)                               |
| `cron`, `devices`, `users`, `sessions`, `status`, `health`, `logs`, `secrets`, `nodes`, `gateway call` | **안 된다.** RPC 전용                                                            |

- 로컬 읽기는 부서로 좁히지 않는다. 컨테이너에 들어갈 수 있는 사람은 이미 상태 파일을 통째로
  열 수 있으므로, 행을 걸러 봐야 시늉에 그친다. 화면과 CSV 의 부서 좁히기는 그대로다.
- **안 되는 명령의 대안은 화면(Control UI)이다.** 브라우저의 핸드셰이크는 로그인 세션 쿠키로
  인증되므로 공유 시크릿 없이 같은 RPC 가 통한다. 자동화(`cron add`)는 화면의 자동화 항목에서,
  기기 목록은 설정 > 기기에서 한다.
- 감사 원장은 화면 말고도 `GET /auth/admin/audit/export.csv`(로그인 쿠키 + 관리자 판정,
  최대 10,000행)로 받는다.
- 주기 실행이 필요하면 **호스트 systemd 타이머**로 건다. 컨테이너 안의 `cron add` 는 쓰지 않는다
  (12절의 색인 갱신이 그 예다).

## 10. 확인된 제약

| 제약                    | 내용                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 역할 변경 반영 지연     | 콘솔에서 역할만 바꾸면 최대 15분 늦게 반영된다. 즉시 반영하려면 세션도 함께 종료한다 (AUTH-IXAUTH.md 7.3)                                                                                                                    |
| 부서 접근 강제          | **구현됨**(B 단계). 로컬 CLI `agents list`·`sessions` 는 게이트웨이를 안 타므로 경계 밖이다 (호스트 셸 = 경계 밖)                                                                                                            |
| 초대장 가입 화면        | 미구현. 계정은 콘솔에서 만든다                                                                                                                                                                                               |
| ko 외 로케일            | 번역 제공자 없이 동기화해 영어 폴백 상태다. `pnpm ui:i18n:check` 가 그 때문에 실패한다                                                                                                                                       |
| 메일                    | SMTP 설정이 없다. 비밀번호 재설정·초대 메일은 보내지지 않는다                                                                                                                                                                |
| 부서 에이전트 파일 읽기 | **구독 OAuth(codex) 경로에서는 쓸 수 없다.** 그 런타임의 읽기 전용 샌드박스가 파일시스템 전체 읽기라 폴더 경계가 서지 않는다. 부서 에이전트는 API 키 모델(3.4 (가))로 준다 ([AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 13.9) |

## 11. 사내망 IP:포트 프로파일

> 도메인도 DNS 도 없이 `http://<사내 IP>:18800` 으로 배치하는 경우다.\
> 설계 근거는 `infra/local/openclaw-jinbio-nas-feasibility.md` 7절, 폴더 통제는\
> [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 13절.

### 11.1 바꿔야 하는 것은 값 하나뿐이다

| 항목                                                | 값                           | 어디서                                                      |
| --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `gateway.bind`                                      | `lan`                        | 이미 그렇다. `start-gateway.sh` 가 `--bind lan` 으로 띄운다 |
| `gateway.publicOrigin` / `controlUi.allowedOrigins` | `http://192.168.10.20:18800` | `.env` 의 `OPENCLAW_PUBLIC_ORIGIN` 하나로 렌더링된다        |
| 호스트 포트                                         | `18800`                      | `.env` 의 `OPENCLAW_GATEWAY_PORT`                           |

```bash
# chris-local/ixauth.env
OPENCLAW_PUBLIC_ORIGIN=http://192.168.10.20:18800
```

도메인·서브도메인·인증서·DNS 레코드는 하나도 필요 없다.\
IX-Auth 의 `issuer`·`audience` 는 고정 리터럴이라 주소와 무관하고(2절), 브라우저가 보는 유일한\
URL 키가 `publicOrigin` 이다. 오리진 검증은 문자열 완전 일치라 `IP:포트` 가 그대로 통과한다.

값을 바꾼 뒤에는 반드시 다시 기동한다. 설정은 기동 시점에 렌더링된다.

### 11.2 평문 HTTP 에서 세션이 유지되는 이유

기본 세션 쿠키 이름은 `__Host-openclaw-session` 이다. `__Host-` 접두 쿠키는 브라우저가 `Secure`\
없이는 저장하지 않고, `Secure` 는 평문 HTTP 에서 거부된다. 그대로면 사내망 IP 접속에서 로그인이\
말없이 실패한다.

게이트웨이는 그 경우 **접두사를 떼고 `Secure` 없이** 쿠키를 내린다.

| 무엇                    | 어디                                                                   |
| ----------------------- | ---------------------------------------------------------------------- |
| 보안 컨텍스트 판정      | `src/gateway/cookie-header.ts:135-150` `isSecureGatewayBrowserContext` |
| 쓸 때 접두사 제거       | `src/gateway/ix-auth-http.ts:86-92` `resolveEffectiveCookieName`       |
| `Secure` 속성           | `src/gateway/ix-auth-http.ts:64-78` (판정 결과를 그대로 쓴다)          |
| 읽을 때 두 이름 다 시도 | `src/gateway/ix-auth-principal.ts:21-34` `readIxAuthSessionCookie`     |

읽는 쪽은 설정된 이름으로 먼저 찾고, 없으면 `__Host-` 를 뗀 이름으로 한 번 더 찾는다\
(`ix-auth-principal.ts:26-33`). 그래서 설정 값 하나로 TLS 배포와 평문 배포가 모두 성립한다.\
동반 CSRF 쿠키도 세션 쿠키 이름에서 파생되므로 같이 접두사를 잃는다.

보안 컨텍스트[<sup>5</sup>](#g5)로 인정되는 것은 **TLS 종단**, **루프백 주소**, 그리고 **신뢰하는 프록시가 보낸\
`x-forwarded-proto: https`** 셋뿐이다(`cookie-header.ts:141-150`).\
`x-forwarded-proto` 는 `gateway.trustedProxies` 에 등록된 주소에서 온 요청에서만 읽는다.\
등록하지 않으면 아무나 HTTPS 를 자칭해 브라우저가 버릴 `Secure` 쿠키를 유도할 수 있기 때문이다.

#### 대가

이 폴백은 **동작을 살리는 것이지 안전을 만드는 것이 아니다.**

| 손실           | 결과                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| 세션 쿠키 평문 | 같은 LAN 에서 스니핑·ARP 스푸핑으로 쿠키를 가져가면 **그 사람으로 로그인된다** |
| 자격증명 평문  | 로그인 이메일·비밀번호가 그대로 흐른다                                         |
| 무결성 없음    | 응답·스크립트 주입을 막을 수단이 없다                                          |

"사내망이라 괜찮다" 는 것은 사내망에 있는 모든 기기를 신뢰한다는 뜻이다.\
개인 노트북·프린터·게스트 와이파이가 같은 대역에 있으면 그 전제가 성립하지 않는다.

### 11.3 권고: IP SAN 사설 인증서 리버스 프록시

도메인 없이도 TLS 는 가능하다. 인증서의 SAN 에 **IP 주소**를 넣으면 된다.\
그러면 11.2 의 손실이 사라지고 `__Host-`·`Secure` 도 돌아온다.

#### (가) 인증서 만들기

```bash
sudo mkdir -p /etc/nginx/tls
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 398 \
  -keyout /etc/nginx/tls/gateway.key \
  -out    /etc/nginx/tls/gateway.crt \
  -subj   "/CN=192.168.10.20" \
  -addext "subjectAltName=IP:192.168.10.20" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"
sudo chmod 600 /etc/nginx/tls/gateway.key

# 확인: SAN 에 IP 가 들어갔는지
openssl x509 -in /etc/nginx/tls/gateway.crt -noout -text | grep -A1 "Subject Alternative Name"
```

`CN` 만으로는 요즘 브라우저가 인정하지 않는다. **SAN 의 `IP:` 항목이 실제로 판정에 쓰인다.**\
유효기간을 398일로 잡은 것은 그보다 긴 잎 인증서를 거부하는 브라우저가 있기 때문이다.\
만든 `gateway.crt` 는 사내 PC 에 "신뢰할 수 있는 루트 인증 기관" 으로 배포한다.

#### (나) nginx

```nginx
# /etc/nginx/conf.d/openclaw.conf
map $http_upgrade $connection_upgrade {
  default upgrade;
  ""      close;
}

server {
  listen 18443 ssl;
  http2 on;
  server_name 192.168.10.20;

  ssl_certificate     /etc/nginx/tls/gateway.crt;
  ssl_certificate_key /etc/nginx/tls/gateway.key;
  ssl_protocols       TLSv1.2 TLSv1.3;

  # 첨부 업로드가 막히지 않게 넉넉히 잡는다
  client_max_body_size 100m;

  location / {
    proxy_pass http://127.0.0.1:18800;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;

    # Control UI 는 WebSocket 으로 붙는다. 이 두 줄이 없으면 화면이 영원히 연결 중이다
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;

    # 대화는 오래 열려 있고 응답은 스트리밍이다
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering    off;
  }
}
```

`map` 블록의 빈 문자열 값은 nginx 문법상 작은따옴표 두 개(`''`)로 적어도 같다.

#### (다) 프록시를 앞에 둘 때 같이 바꾸는 것

```bash
# chris-local/ixauth.env
OPENCLAW_PUBLIC_ORIGIN=https://192.168.10.20:18443
```

```json5
// ixauth-gateway-config/openclaw.json 의 gateway 아래
{
  gateway: {
    // 프록시가 보낸 x-forwarded-proto 를 읽으려면 그 출처를 등록해야 한다.
    // 호스트에서 publish 된 포트를 거쳐 들어오면 컨테이너가 보는 주소는 127.0.0.1 이
    // 아니라 브리지 게이트웨이(172.x.0.1)다. 실제 값은 아래 명령으로 확인한다.
    trustedProxies: ["172.16.0.0/12", "127.0.0.1"],
  },
}
```

```bash
# 컨테이너가 실제로 보는 출발 주소 확인
docker compose --env-file chris-local/ixauth.env \
  -f chris-local/docker-compose.ixauth.yml logs gateway | tail -50

# 게이트웨이 포트를 프록시가 있는 호스트에서만 열리게 좁힌다 (7절)
#   ports: - "127.0.0.1:${OPENCLAW_GATEWAY_PORT:-18800}:18789"
```

`trustedProxies` 를 비워 두면 프록시를 세워도 게이트웨이는 여전히 평문 접속으로 판정하고\
접두사 없는 쿠키를 내린다. 동작은 하지만 `__Host-`·`Secure` 는 돌아오지 않는다.

### 11.4 NAS 공유 마운트 절차

에이전트가 NAS 부서 폴더를 보게 하는 3단계다. 설계는 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 13절.

#### (가) 호스트에 마운트한다

```bash
sudo mkdir -p /srv/nas/rnd /srv/nas/qa

# 자격증명은 파일로 뺀다. fstab 에 비밀번호를 적지 않는다
sudo install -m 600 /dev/null /etc/nas-credentials
sudo nano /etc/nas-credentials
#   username=<읽기전용계정>
#   password=<비밀번호>
```

```text
# /etc/fstab - SMB(cifs)
//<NAS-IP>/rnd  /srv/nas/rnd  cifs  credentials=/etc/nas-credentials,ro,uid=1000,gid=1000,file_mode=0444,dir_mode=0555,vers=3.0,_netdev,nofail  0  0

# /etc/fstab - NFS 를 쓰는 경우
<NAS-IP>:/volume1/rnd  /srv/nas/rnd  nfs  ro,soft,timeo=100,_netdev,nofail  0  0
```

```bash
sudo mount -a
mount | grep /srv/nas          # ro 로 붙었는지 확인
touch /srv/nas/rnd/x           # "Read-only file system" 이 나와야 정상
```

`nofail` 은 NAS 가 꺼져 있을 때 호스트 부팅이 멈추지 않게 한다.\
`ro` 는 호스트 단계의 1차 방어선이고, NAS 계정 자체를 읽기 전용으로 만드는 것이 더 확실하다.

#### (나) compose 에 넣는다

```bash
# chris-local/ixauth.env
OPENCLAW_NAS_ROOT=/srv/nas
```

`docker-compose.ixauth.yml` 이 그 아래 `rnd`·`qa` 를 `/mnt/nas/rnd`·`/mnt/nas/qa` 로 `:ro` 마운트하고,\
`start-gateway.sh` 가 이 값이 비어 있지 않을 때만 `rnd-bot`·`qa-bot` 워크스페이스를 그 경로로 바꾼다.\
값을 비우면 마운트만 남고 워크스페이스는 상태 디렉터리 안의 기본 경로로 돌아간다.

**인사·급여 폴더는 `volumes:` 에 넣지 않는다.** 안 넣은 폴더는 컨테이너 안에 존재하지 않는다.\
차단 목록을 관리하는 대신 마운트 목록만 관리하는 것이 이 배포의 폴더 통제 전부다.

**워크스페이스 부트스트랩에 주의한다.** `OPENCLAW_NAS_ROOT` 를 켜면 `rnd-bot`·`qa-bot` 의\
`skipBootstrap` 이 `true` 로 렌더링된다. 읽기 전용 워크스페이스에서는 `AGENTS.md` 발행이\
`EROFS` 로 실패해 첫 턴이 죽기 때문이다. G 단계에서 에이전트별 키를 추가해 `main` 은 영향을 받지\
않는다. 근거는 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 13.7 에 있다.

#### (다) 컨테이너 안에서 확인한다

```bash
CO="docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml"

$CO up -d

# 마운트가 붙었는지, ro 인지
$CO exec gateway sh -c "ls /mnt/nas && grep /mnt/nas /proc/mounts"

# 쓰기가 실패하는 것이 정상이다
$CO exec gateway sh -c "touch /mnt/nas/rnd/x"     # "Read-only file system"

# 인사 폴더는 없어야 한다
$CO exec gateway sh -c "ls /mnt/nas/hr"           # "No such file or directory"

# 렌더링된 설정에 워크스페이스가 실제로 들어갔는지
$CO exec gateway sh -c "grep -A2 workspace /home/node/.openclaw/openclaw.json"
```

#### (라) 마운트가 끊겼을 때

| 증상                                    | 확인                                                                  |
| --------------------------------------- | --------------------------------------------------------------------- |
| 에이전트가 "폴더가 비어 있다" 고 답한다 | 호스트에서 `mount` 출력에 `/srv/nas` 줄이 있는지. 없으면 빠진 것이다  |
| 파일 목록은 나오는데 읽기에서 멈춘다    | NAS 가 응답하지 않는다. 호스트에서 `ls /srv/nas/rnd` 도 멈추는지 본다 |
| 컨테이너 안 `/mnt/nas/rnd` 가 비었다    | 마운트 시점 문제다. 호스트에서 다시 마운트한 뒤 컨테이너를 재시작한다 |
| 재부팅 후 사라졌다                      | `/etc/fstab` 항목이 없거나 `_netdev` 가 빠졌다                        |

호스트에서 다시 마운트해도 컨테이너 안 바인드 마운트는 **끊긴 예전 것을 계속 본다.**\
`mount -a` 뒤에는 게이트웨이 컨테이너를 재시작한다.

### 11.5 사용자 20명을 CSV 로 한 번에 넣기

NAS 로컬 사용자 목록을 계정으로 옮기는 절차다. 화면은 F 단계에서 만든 **설정 > 사용자 관리**\
(`/settings/users`)의 CSV 가져오기이고, 형식 정본은 [AUTH-USERS.md](AUTH-USERS.md) 6절이다.

#### (가) 형식

```csv
email,name,roles,departments
kim@example.com,김철수,MEMBER,dept-rnd
lee@example.com,이영희,EXECUTIVE,dept-rnd;dept-qa
park@example.com,박민수,ADMIN,
```

| 항목     | 규칙                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| 헤더     | **필수.** 열 이름으로 매핑한다                                                  |
| 열 이름  | `email`(필수), `name`/`displayName`, `role`/`roles`, `department`/`departments` |
| 여러 값  | 역할·부서는 세미콜론 또는 세로줄로 나눈다. 쉼표는 CSV 구분자다                  |
| 상한     | 500행. 넘으면 신원 서버를 부르기 전에 400 `too_many_rows`                       |
| 비밀번호 | 만들지 않는다. 전원에게 초대 메일이 나가고 본인이 정한다                        |
| 실패     | 행 단위. 한 줄이 틀려도 나머지는 들어간다. 결과에 줄 번호와 사유가 나온다       |

부서 열에는 **그룹 코드를 그대로** 적는다. 접두사를 포함한 `dept-rnd` 이지 `rnd` 가 아니다.\
역할 열에 이 배포가 모르는 코드가 하나라도 있으면 파일 전체가 거절된다.

#### (나) 순서

```text
1. IX-Auth 콘솔에서 부서 그룹을 먼저 만든다 (3.3). CSV 의 dept- 코드가 이미 있어야 한다
2. NAS 사용자 목록을 위 4개 열로 옮긴다
   - email 이 없는 로컬 계정은 만들 수 없다. 사내 메일 주소를 먼저 정한다
   - 부서는 그 사람이 쓰던 공유 폴더에서 그대로 딴다
   - 역할은 기본 MEMBER, 임원만 EXECUTIVE, 관리자만 ADMIN
3. 설정 > 사용자 관리 > CSV 가져오기 로 올린다
4. 결과의 실패 행(줄 번호와 사유)을 고쳐 그 줄만 다시 올린다
5. 목록에서 부서 필터로 부서별 인원을 눈으로 확인한다
6. 부서별 에이전트를 만들고 묶는다 (AUTH-DEPARTMENTS.md 13.6)
```

메일이 나가지 않는 배포(`IXAUTH_MAIL_TRANSPORT=WEBHOOK`)에서는 초대 링크가 화면에 남는다.\
20명이면 링크를 하나씩 전달해야 하므로, CSV 가져오기 전에 SMTP 를 먼저 붙이는 편이 낫다(2.1).

부서를 나중에 통째로 바꿀 때도 같은 화면을 쓴다. 목록에서 부서로 거른 뒤 역할·부서를 고치는 편이\
CSV 를 다시 올리는 것보다 안전하다. CSV 는 **추가**용이다.

### 11.6 어디에 설치할 것인가

**NAS 에 직접 설치하는 것은 PoC 로만 한다.** 상시 운영은 별도 x86 호스트(미니PC 또는 VM)를 권한다.

이 스택은 컨테이너 4개이고, 게이트웨이 하나가 Node 와 Chromium 과 LibreOffice 를 함께 들고 있다.\
여기에 JVM(신원 서버)과 PostgreSQL 이 붙는다. 저사양 2코어 NAS 에서는 문서 미리보기 한 번에\
CPU 가 포화되고, 그동안 NAS 본래의 파일 서비스가 같이 느려진다. 요구 사양은 1절에 있다.

NAS 는 **파일 공유 자리로 두고**, 게이트웨이 호스트가 그 공유를 읽기 전용으로 마운트하는 배치가\
11.4 의 그림이다. 그러면 NAS 부하는 파일 읽기뿐이고, 모델·변환·브라우저는 전부 별도 호스트에 남는다.

### 11.7 Cloudflare Tunnel 프로파일 (jinbio.botops.cloud)

사용자 결정(2026-09-07): 개인 도메인 `botops.cloud` 의 서브도메인 **`jinbio.botops.cloud`** 로 서비스하고,TLS 는 Cloudflare 가 맡는다. cloudflared 컨테이너를 이 스택에 함께 띄워 홈랩 Cloudflare 계정의터널로 게이트웨이를 노출한다.

| 항목              | 값                                                                       |
| ----------------- | ------------------------------------------------------------------------ |
| 주소              | `https://jinbio.botops.cloud`                                            |
| TLS               | Cloudflare 자동 (인증서 발급·갱신 없음)                                  |
| 공유기 포트포워딩 | 필요 없다 (cloudflared 가 나가는 연결만 쓴다)                            |
| 공인 IP · NS 이전 | 필요 없다                                                                |
| WebSocket         | 그대로 통과한다 (Control UI 가 이것으로 붙는다)                          |
| 적용 범위         | **PoC·데모·초기 운영.** 정식 납품 시 진바이오테크 자체 도메인으로 옮긴다 |

경계를 분명히 해 둔다. 이 주소는 감독 개인 계정의 도메인이고 터널도 그 계정의 것이다.고객이 상시 운영에 들어가면 고객 도메인과 고객 계정으로 옮겨야 한다. 옮길 때 바뀌는 것은`OPENCLAW_PUBLIC_ORIGIN` 과 터널 토큰 두 개뿐이다.

#### (가) 터널을 만든다

Cloudflare 대시보드에서 한 번만 한다. 저장소에서 할 일은 없다.

1. Zero Trust > Networks > Tunnels > **Create a tunnel** > Cloudflared.
2. 이름을 정하고 만들면 **토큰**이 나온다. 이 값이 자격증명이다.
3. 만든 터널의 **Public Hostname** 에 한 줄 추가한다.

   | 칸        | 값              |
   | --------- | --------------- |
   | Subdomain | `jinbio`        |
   | Domain    | `botops.cloud`  |
   | Type      | `HTTP`          |
   | URL       | `gateway:18789` |

   **호스트의 `127.0.0.1:18800` 이 아니다.** cloudflared 는 이 스택의 compose 네트워크 안에서 돌고, 거기서 게이트웨이는 서비스 이름 `gateway` 의 컨테이너 포트 `18789` 로 보인다. 호스트 포트는 같은 곳으로 가는 두 번째 문일 뿐이고, 그쪽으로 돌리면 터널이 호스트의 포트 게시에 의존하게 된다.

#### (나) 값을 넣고 띄운다

```bash
# chris-local/ixauth.env
OPENCLAW_PUBLIC_ORIGIN=https://jinbio.botops.cloud
OPENCLAW_TRUSTED_PROXIES=172.16.0.0/12
CLOUDFLARE_TUNNEL_TOKEN=<대시보드에서 받은 토큰>
```

```bash
docker compose --env-file chris-local/ixauth.env   -f chris-local/docker-compose.ixauth.yml --profile tunnel up -d
```

`--profile tunnel` 을 주지 않으면 cloudflared 서비스 자체가 만들어지지 않는다. 프로파일 없이 쓰던스택은 이 변경 뒤에도 그대로다.

세 값이 한 벌이다.

| 값                         | 없으면                                                         |
| -------------------------- | -------------------------------------------------------------- |
| `OPENCLAW_PUBLIC_ORIGIN`   | 로그인 폼이 403 `origin_not_allowed`, 또는 화면이 계속 연결 중 |
| `OPENCLAW_TRUSTED_PROXIES` | 로그인은 되지만 쿠키가 평문 배포 모양 그대로다 (아래 (다))     |
| `CLOUDFLARE_TUNNEL_TOKEN`  | `docker compose` 가 변수 없음으로 거부한다                     |

#### (다) 평문 HTTP 의 손실이 사라진다

11.2 가 적어 둔 손실 세 가지(세션 쿠키 평문, 자격증명 평문, 무결성 없음)는 브라우저와Cloudflare 사이가 TLS 가 되면서 사라진다. 남는 평문 구간은 cloudflared 컨테이너와 게이트웨이컨테이너 사이, 즉 이 스택의 내부 네트워크뿐이다.

쿠키 모양도 되돌아온다. 게이트웨이는 `x-forwarded-proto: https` 를 **`gateway.trustedProxies` 에등록된 주소에서 온 요청에서만** 읽고(`src/gateway/cookie-header.ts` 의 `isSecureGatewayBrowserContext`),cloudflared 는 compose 네트워크의 컨테이너라 그 주소가 172.x 대역이다. 그래서`OPENCLAW_TRUSTED_PROXIES=172.16.0.0/12` 을 넣어야 `__Host-` 접두와 `Secure` 가 다시 붙는다.`start-gateway.sh` 가 이 값을 `gateway.trustedProxies` 로 렌더링한다.

172.16.0.0/12 은 Docker 기본 주소 풀을 덮는 범위다. 실제 주소를 확인하려면 아래를 본다.

```bash
docker compose --env-file chris-local/ixauth.env   -f chris-local/docker-compose.ixauth.yml exec gateway sh -c 'ip route | head -3'
```

이 목록은 **터널이나 리버스 프록시가 앞에 있을 때만** 채운다. 평문 HTTP 로 직접 여는 배치(11.1)에서같은 값을 넣으면, 그 대역에서 오는 아무 요청이나 HTTPS 를 자칭해 브라우저가 버릴 `Secure` 쿠키를받아 갈 수 있다. 증상은 이유 없이 실패하는 로그인이다.

게이트웨이 쪽에 이것 말고 더 할 설정은 없다. `issuer`·`audience` 는 고정 리터럴이라 주소와 무관하고,`gateway.bind` 는 컨테이너 안에서 계속 `lan` 이면 된다. cloudflared 가 같은 네트워크에서 붙기 때문이다.

#### (라) 확인

```bash
# 터널이 붙었나 (Registered tunnel connection 줄이 4개쯤 뜬다)
docker compose --env-file chris-local/ixauth.env   -f chris-local/docker-compose.ixauth.yml --profile tunnel logs cloudflared | tail -20

# 밖에서 열리나
curl -s -o /dev/null -w '%{http_code}
' https://jinbio.botops.cloud/
```

브라우저에서는 로그인한 뒤 개발자 도구 > Application > Cookies 에서 이름이`__Host-openclaw-session` 이고 `Secure` 가 켜져 있는지 본다. 접두가 없으면 (나) 의`OPENCLAW_TRUSTED_PROXIES` 가 렌더된 설정에 들어가지 않은 것이다.

#### (마) 되돌리기

```bash
docker compose --env-file chris-local/ixauth.env   -f chris-local/docker-compose.ixauth.yml --profile tunnel down cloudflared
```

그다음 `.env` 의 `OPENCLAW_PUBLIC_ORIGIN` 을 원래 주소로, `OPENCLAW_TRUSTED_PROXIES` 를 빈 값으로되돌리고 게이트웨이를 다시 띄운다. 이 둘을 되돌리지 않으면 화면이 오리진 불일치로 열리지 않는다.Cloudflare 쪽 터널은 대시보드에서 지운다.

## 12. NAS 문서를 검색 가능하게 만들기 (마크다운 사이드카 색인)

> 정본은 [KNOWLEDGE.md](KNOWLEDGE.md). 여기에는 설치·운영에 필요한 최소 절차만 둔다.

메모리 색인기는 `.md` 만 모은다. 그래서 11.4 로 공유를 마운트해도 그 안의 pdf·docx·xlsx·pptx 는
검색에 잡히지 않는다. `openclaw knowledge sync` 가 문서마다 마크다운 사이드카를 만들어
**호스트 로컬 색인 폴더**에 쌓고, 부서 에이전트가 그 폴더를 `memory.search.extraPaths` 로 본다.

### 12.1 변수와 마운트

```bash
# chris-local/ixauth.env
OPENCLAW_NAS_ROOT=/srv/nas              # 공유의 부모 (읽기 전용)
OPENCLAW_KNOWLEDGE_ROOT=/srv/knowledge  # 색인의 부모 (쓰기 가능, NAS 가 아니어야 한다)
```

```bash
sudo mkdir -p /srv/knowledge/rnd /srv/knowledge/qa
sudo chown -R 1000:1000 /srv/knowledge     # 컨테이너의 node 사용자
```

compose 가 `/mnt/knowledge/rnd`·`/mnt/knowledge/qa` 로 쓰기 가능하게 마운트하고,
`start-gateway.sh` 는 `OPENCLAW_KNOWLEDGE_ROOT` 가 비어 있지 않을 때만 두 부서 에이전트의
`extraPaths` 를 그 경로로 렌더링한다. 비우면 빈 목록이라 이 기능이 없던 때와 동작이 같다.

**색인 폴더를 NAS 에 두지 않는다.** 공유는 읽기 전용이 원칙이고, 색인이 호스트에 있는 이유가 그것이다.

### 12.2 첫 색인과 확인

```bash
CO="docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml"
$CO up -d

$CO exec gateway openclaw knowledge sync --source /mnt/nas/rnd --out /mnt/knowledge/rnd
$CO exec gateway openclaw knowledge sync --source /mnt/nas/qa  --out /mnt/knowledge/qa

# 사이드카가 생겼는지
$CO exec gateway sh -c "ls /mnt/knowledge/rnd"

# 렌더링된 설정에 extraPaths 가 들어갔는지
$CO exec gateway sh -c "grep -A3 extraPaths /home/node/.openclaw/openclaw.json"

# 색인기에 알린다. 이 단계를 빼면 사이드카가 있어도 검색에 안 잡힌다
$CO exec gateway openclaw memory index --force --agent rnd-bot
$CO exec gateway openclaw memory search "에탄올 재고" --agent rnd-bot
```

색인은 임베딩을 부르지 않는다. 납품 템플릿의 `memory.search.provider` 가 `"none"` 이라 내장 FTS 만
쓰고, 한국어는 같은 절의 `store.fts.tokenizer: "trigram"` 이 받는다. 기본값 `openai` 로 두면 키가
없는 사내 배포에서 색인이 통째로 실패한다(12.4). 근거와 대안은 KNOWLEDGE.md 7.4.

### 12.3 주기 실행은 호스트 타이머로 한다

ix-auth 모드에서 컨테이너 안 CLI 는 게이트웨이 RPC 인가가 없어 `openclaw cron add` 가
`unauthorized` 로 막힌다(H 단계에서 확인된 제약과 같은 것이다). `knowledge sync` 자체는 RPC 를
쓰지 않아 잘 돌므로, 잡을 만드는 쪽만 밖으로 뺀다.

```ini
# /etc/systemd/system/openclaw-knowledge.service  (Type=oneshot)
ExecStart=/usr/bin/docker compose -f docker-compose.ixauth.yml --env-file ixauth.env exec -T gateway \
  sh -lc 'openclaw knowledge sync --source /mnt/nas/rnd --out /mnt/knowledge/rnd && openclaw memory index --force --agent rnd-bot'
```

타이머 유닛과 30분 주기 예시는 KNOWLEDGE.md 7.3 에 있다.

### 12.4 자주 나오는 증상

| 증상                                   | 원인·조치                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 사이드카는 있는데 검색이 빈손이다      | `openclaw memory index --force --agent <id>` 를 안 돌렸다                                                       |
| `memory index` 가 429 로 실패한다      | 임베딩 제공자가 openai 인데 키·크레딧이 없다. 납품 템플릿은 `memory.search.provider: "none"`(내장 FTS 전용)이다 |
| pptx 만 `failed/converter-unavailable` | 이미지에 LibreOffice 가 없다. D 단계의 빌드 인자를 확인하고 이미지를 다시 만든다                                |
| 스캔 pdf 가 `ignored/empty` 로 남는다  | 텍스트 층이 없는 이미지 pdf 다. OCR 은 범위 밖이다                                                              |
| hwp 가 통째로 빠진다                   | 지원 대상이 아니다(사용자 확정). `ignored/extension` 으로 집계된다                                              |
| 쓰기 권한 오류                         | 색인 폴더 소유자가 컨테이너의 `node`(uid 1000)가 아니다                                                         |
| 원본을 지웠는데 답변에 계속 나온다     | 동기를 한 번 더 돌려 사이드카를 지우고 재색인한다                                                               |

## 13. 진바이오 NAS 배치 (CI/CD)

> 사용자 결정(2026-09-08): 진바이오테크 NAS 에 납품 스택을 직접 설치하고, 코드를 고치면 이미지가 자동으로 갱신되게 한다. 11.6 이 적어 둔 "NAS 직접 설치는 PoC 로만" 이라는 권고는 그대로 유효하고, 이 배치가 그 PoC 다.
>
> 저장소 쪽 정본 파일은 [chris-local/nas/](nas/) 폴더와 `.github/workflows/chris-deliver-images.yml` 이다.

### 13.1 흐름

```
D:\PROJECT\openclaw  --(git push origin chris/main)-->  GitHub 포크
                                                            |
                              GitHub Actions "Chris Deliver Images"
                              게이트웨이 이미지 + ix-auth 이미지 빌드
                                                            |
                        ghcr.io/necromman/openclaw-gateway:chris-main
                        ghcr.io/necromman/openclaw-ix-auth:chris-main
                                                            |
                           (5분 주기 cron) NAS 의 deploy.sh 가 다이제스트 비교
                                                            |
                         다르면 pull -> up -d -> 헬스 대기 -> 옛 이미지 정리
                                                            |
                     진바이오 NAS /volume1/docker/openclaw (컨테이너 4개)
                                                            |
                              cloudflared -> https://jinbio.botops.cloud
```

NAS 는 2코어 Celeron 이라 게이트웨이 이미지를 스스로 빌드할 수 없고, git 도 없다. 그래서 이 배치에서 NAS 가 하는 일은 "레지스트리에 새 이미지가 있으면 받아서 다시 띄운다" 하나뿐이다.

### 13.2 CI: GitHub Actions 가 이미지를 굽는다

워크플로 `.github/workflows/chris-deliver-images.yml`. 업스트림 워크플로는 건드리지 않았고, 이 포크가 더한 CI 는 이 파일 하나다.

| 항목      | 값                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------- |
| 트리거    | `chris/main` 푸시, 그리고 수동 실행                                                            |
| 동시 실행 | `concurrency` 로 최신 것만 남긴다. 늦게 끝난 옛 빌드가 `chris-main` 을 뒤로 돌리는 일을 막는다 |
| 잡        | `gateway image`(저장소 루트 `Dockerfile`), `ix-auth image`(`ix-auth/docker/Dockerfile`)        |
| 빌드 인자 | compose 의 `gateway.build.args` 와 같은 값. 브라우저·한글 폰트·LibreOffice 가 여기서 들어간다  |
| 대상      | `ghcr.io/necromman/openclaw-gateway`, `ghcr.io/necromman/openclaw-ix-auth` (둘 다 public)      |
| 태그      | `chris-main`(움직인다, NAS 가 보는 것) + `sha-<짧은 커밋>`(움직이지 않는다, 되돌릴 때 쓴다)    |
| 캐시      | 레지스트리 캐시 `:buildcache` (`mode=max`)                                                     |
| 인증      | `GITHUB_TOKEN` + `permissions: packages: write`                                                |

러너에서 먼저 하는 일이 디스크 확보다. 게이트웨이 이미지는 Chromium 과 LibreOffice 를 포함해 압축 전 7 GB 대이고, 기본 러너에는 buildx 캐시와 내보내기를 함께 둘 자리가 없다. 쓰지 않는 SDK(dotnet·android·ghc 등)를 지워 약 25 GB 를 돌려받는다.

이미지에 시크릿은 굽히지 않는다. 설정은 `ixauth-gateway-config/` 를 읽기 전용으로 마운트해 넣고, 자격증명은 전부 런타임 환경변수다. `IXAUTH_SERVICE_KEY` 같은 값은 게이트웨이 설정 파일에 `"${IXAUTH_SERVICE_KEY}"` 라는 이름으로만 적혀 있다.

패키지는 **public** 으로 둔다. 저장소가 공개이고 이미지에 시크릿이 없으므로 숨길 것이 없으며, 공개라야 NAS 의 `deploy.sh` 가 자격증명 없이 다이제스트를 읽고 `docker pull` 을 할 수 있다. 비공개로 두려면 NAS 에 읽기 전용 토큰을 넣고 `docker login ghcr.io` 를 먼저 시켜야 한다.

### 13.3 NAS 에 두는 파일

```
/volume1/docker/openclaw/
  docker-compose.nas.yml      chris-local/nas/ 에서 복사
  deploy.sh                   chris-local/nas/ 에서 복사 (실행권한 필요)
  ixauth-gateway-config/      chris-local/ixauth-gateway-config/ 에서 복사
  nas-sample/                 chris-local/nas-sample/ 에서 복사
  knowledge-index/rnd, /qa    빈 폴더
  ixauth.env                  호스트에서 만든다 (0600, root 소유). 복사하지 않는다
  deploy.log                  deploy.sh 가 만든다
```

`docker-compose.nas.yml` 은 `docker-compose.ixauth.yml` 의 형제다. 다른 점은 셋뿐이고 파일 머리말에 적혀 있다. `build:` 대신 `image:`, 컨테이너별 `mem_limit`, 개발용 수신함(mailpit) 제거.

NAS 의 docker-compose 는 **1.28.5** 다. 그 버전이 처음으로 `profiles` 와 version 키 없는 Compose Specification 을 읽는다. `version: "3.x"` 를 적으면 `mem_limit` 가 무시되므로 적지 않는다. `init`·`cap_drop`·`security_opt`·healthcheck·`depends_on.condition` 은 이 버전에서 그대로 동작한다(2026-09-08 NAS 에서 `docker-compose config` 로 확인).

`depends_on.condition` 에는 실측한 한계가 하나 있다. 1.28.5 는 의존 서비스가 healthy 가 될 때까지 잠깐만 기다리고, 그 안에 안 되면 `ERROR: for cloudflared Container "..." is unhealthy.` 로 `up` 전체를 실패시킨다. 게이트웨이는 첫 기동에 1분 30초쯤 걸려서 이 조건을 걸면 첫 배포가 반드시 실패한다(2026-09-08 실측). 그래서 cloudflared 만 짧은 형식 `depends_on: [gateway]` 을 쓴다. cloudflared 는 원본이 아직 없는 동안 502 를 내고 계속 재시도하므로 순서만 정하면 된다. db 와 ix-auth 는 각각 10초·1분 안에 healthy 가 되어 조건이 그대로 통한다.

메모리 상한은 NAS 가 파일 서비스와 기존 컨테이너 7개를 함께 돌리는 기계라서 건다.

| 컨테이너      | `mem_limit` | 근거                                                               |
| ------------- | ----------- | ------------------------------------------------------------------ |
| `gateway`     | 3g          | Node + Chromium + LibreOffice. 문서 변환이 가장 크게 쓰는 지점이다 |
| `ix-auth`     | 768m        | JVM 힙은 이미지의 `MaxRAMPercentage=75` 가 여기서 계산한다         |
| `ix-auth-db`  | 512m        | PostgreSQL 16                                                      |
| `cloudflared` | 128m        | 나가는 연결 하나                                                   |

### 13.4 첫 설치

NAS 에는 git 이 없다. 파일은 apps01 을 거쳐 두 번 복사한다(Windows 의 ssh 에는 `sshpass` 가 없고, DSM 6 의 sshd 에는 sftp 서브시스템이 없어 `scp -O` 가 필요하다). 접속 절차는 `infra/local/jinbio-nas.md` 5절.

```bash
# 1) 보낼 것을 묶는다 (저장소 루트에서)
mkdir -p /tmp/ocnas/openclaw
cp chris-local/nas/docker-compose.nas.yml chris-local/nas/deploy.sh /tmp/ocnas/openclaw/
cp -r chris-local/ixauth-gateway-config chris-local/nas-sample /tmp/ocnas/openclaw/
mkdir -p /tmp/ocnas/openclaw/knowledge-index/rnd /tmp/ocnas/openclaw/knowledge-index/qa
(cd /tmp/ocnas && tar czf /tmp/ocnas.tgz openclaw)

# 2) apps01 로, 다시 NAS 로
scp /tmp/ocnas.tgz chris@192.168.100.12:/tmp/ocnas.tgz
ssh chris@192.168.100.12 "sshpass -p '<NAS 비번>' scp -O -o PreferredAuthentications=password \
  -o PubkeyAuthentication=no /tmp/ocnas.tgz jinbiotec@192.168.2.1:/tmp/ocnas.tgz"

# 3) NAS 에서 root 로 펼친다
sudo mkdir -p /volume1/docker/openclaw
sudo tar xzf /tmp/ocnas.tgz -C /volume1/docker
sudo chmod +x /volume1/docker/openclaw/deploy.sh \
  /volume1/docker/openclaw/ixauth-gateway-config/start-gateway.sh
sudo chown -R root:root /volume1/docker/openclaw
```

`ixauth.env` 는 `chris-local/ixauth.env.example` 을 보고 NAS 에서 만든다. 값은 새로 만들고(`openssl rand`), **저장소에는 넣지 않는다.** 이 배치에서 채운 값은 다음과 같다.

| 변수                                   | 값                                         | 비고                                                         |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `IXAUTH_SERVICE_KEY`                   | `openssl rand -base64 36`                  | 32자 이상이라야 신원 서버가 뜬다                             |
| `IXAUTH_DB_PASSWORD`                   | `openssl rand -base64 24`                  |                                                              |
| `IXAUTH_ADMIN_EMAIL`                   | 로컬 검증 스택과 같은 주소                 | 첫 부팅에만 시드되고 `SUPERADMIN` 을 받는다                  |
| `IXAUTH_ADMIN_PASSWORD`                | `openssl rand` + 대문자·숫자·기호          | 로그인 뒤 화면에서 바꾼다                                    |
| `OPENCLAW_PUBLIC_ORIGIN`               | `https://jinbio.botops.cloud`              | 터널 주소                                                    |
| `OPENCLAW_TRUSTED_PROXIES`             | `172.16.0.0/12`                            | cloudflared 가 오는 대역. `__Host-`·`Secure` 쿠키가 돌아온다 |
| `CLOUDFLARE_TUNNEL_TOKEN`              | 이미 만들어 둔 `jinbio` 터널의 커넥터 토큰 | 대시보드에서 다시 만들지 않는다                              |
| `IXAUTH_MAIL_TRANSPORT`                | `WEBHOOK`                                  | SMTP 는 배포 후 (3.8)                                        |
| `OPENCLAW_NAS_ROOT`                    | `/volume1/docker/openclaw/nas-sample`      | 실제 공유 매핑은 다음 단계 (11.4)                            |
| `OPENCLAW_KNOWLEDGE_ROOT`              | `/volume1/docker/openclaw/knowledge-index` |                                                              |
| `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` | 빈 값                                      | 배포 후 세팅 (3.4 (라))                                      |

만든 값은 `chris-local/infra/local/jinbio-deploy.md`(git 제외)에 적어 둔다.

> **CR 함정.** 값을 만들 때 `| tr -d '\r\n'` 로 CR 도 함께 지운다. Windows Git Bash 의 `openssl` 은 CRLF 로 출력하고, `tr -d '\n'` 만 하면 값 한가운데에 CR 이 남는다. docker-compose 는 그 CR 자리에서 값을 자르므로 관리자 비밀번호가 짧아진 채로 시드되고, 로그인은 "이메일 또는 비밀번호가 올바르지 않습니다" 로 실패한다. env 파일은 항상 LF 로 저장한다. 확인은 `awk '/\r/{print NR}' ixauth.env` 가 아무것도 내지 않는 것이다.

**시드 계정은 생기지 않는다.** Flyway 마이그레이션이 넣는 것은 역할·권한 정의뿐이고, 계정으로 시드되는 것은 `IXAUTH_ADMIN_EMAIL` 하나다. 로컬 검증 스택의 시험 계정 8개는 손으로 만든 것이라 새 볼륨에는 따라오지 않는다. `reset-seed.sh` 를 돌릴 일도 없다.

기동은 터널 프로파일과 함께 한다.

```bash
cd /volume1/docker/openclaw
sudo /var/packages/Docker/target/usr/bin/docker-compose -p openclaw-ixauth \
  --env-file ixauth.env -f docker-compose.nas.yml --profile tunnel pull
sudo /var/packages/Docker/target/usr/bin/docker-compose -p openclaw-ixauth \
  --env-file ixauth.env -f docker-compose.nas.yml --profile tunnel up -d
```

프로젝트 이름 `-p openclaw-ixauth` 를 반드시 준다. 볼륨 이름(`openclaw-ixauth_gateway-state` 등)과 컨테이너 이름이 여기서 나오고, `deploy.sh` 와 4절 백업 절차가 그 이름을 쓴다.

### 13.5 CD: cron 이 5분마다 본다

`deploy.sh` 가 하는 일은 하나다. ghcr 의 `chris-main` 태그가 지금 가리키는 다이제스트를 익명 토큰으로 읽고, 이 호스트에 있는 같은 태그의 다이제스트와 견준다. 같으면 로그에 "변경 없음" 한 줄만 남기고 끝난다. 다르면 `pull` 하고 `up -d --remove-orphans` 하고 헬스를 기다린 뒤, 갈려 나간 옛 이미지를 지운다.

```
# /etc/crontab 에 한 줄 (칸 구분은 탭이다)
*/5	*	*	*	*	root	/volume1/docker/openclaw/deploy.sh
```

DSM 6 은 `/etc/crontab` 을 고친 뒤 `sudo synoservice --restart crond` 로 다시 읽힌다. 칸을 공백으로 구분하면 DSM 이 그 줄을 통째로 버린다.

```bash
sudo /volume1/docker/openclaw/deploy.sh --force     # 태그가 그대로여도 다시 받는다
sudo /volume1/docker/openclaw/deploy.sh --status    # 컨테이너 헬스와 지금 이미지 다이제스트
tail -20 /volume1/docker/openclaw/deploy.log
```

지키는 규칙은 자동 배포 스크립트(FORK.md 7-5)와 같은 성격이다.

| 규칙                                 | 왜                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `mkdir` 잠금으로 단일 실행           | pull 과 재기동이 5분을 넘길 수 있다. 겹치면 같은 컨테이너를 두 번 내린다 |
| 두 시간 넘은 잠금은 걷어낸다         | 죽은 실행이 남긴 잠금 때문에 배포가 영영 멈추는 것을 막는다              |
| 다이제스트가 같으면 아무것도 안 한다 | 평상시 cron 은 HTTP 요청 두 번으로 끝난다                                |
| ghcr 를 못 읽으면 배포하지 않는다    | 네트워크 문제로 돌던 컨테이너를 내리지 않는다                            |
| `pull` 실패 시 그대로 둔다           | 반쯤 받은 이미지로 재기동하지 않는다                                     |
| 헬스 300초 대기 후 판정              | 안 되면 `WARN` 으로 남기고 사람이 본다                                   |
| `image prune -f` 만 한다             | dangling 만 지운다. NAS 의 다른 앱 이미지는 건드리지 않는다              |

### 13.6 되돌리기

```bash
# (가) 이전 커밋 이미지로 (태그가 움직이지 않는 sha- 태그를 쓴다)
cd /volume1/docker/openclaw
sudo /var/packages/Docker/target/usr/bin/docker tag \
  ghcr.io/necromman/openclaw-gateway:sha-<이전 커밋> \
  ghcr.io/necromman/openclaw-gateway:chris-main
sudo /var/packages/Docker/target/usr/bin/docker-compose -p openclaw-ixauth \
  --env-file ixauth.env -f docker-compose.nas.yml --profile tunnel up -d

# (나) 자동 배포만 끄기
sudo sed -i '/openclaw\/deploy.sh/d' /etc/crontab && sudo synoservice --restart crond

# (다) 스택 전체 내리기 (볼륨은 남는다)
sudo /var/packages/Docker/target/usr/bin/docker-compose -p openclaw-ixauth \
  --env-file ixauth.env -f docker-compose.nas.yml --profile tunnel down
```

(가) 를 하면 다음 cron 이 다시 원격 `chris-main` 으로 되돌린다. 되돌린 상태를 유지하려면 (나) 를 함께 한다.

### 13.7 확인 항목

| 확인                 | 방법                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| 컨테이너 4개 healthy | `sudo /volume1/docker/openclaw/deploy.sh --status`                                 |
| 밖에서 열리나        | `curl -sI https://jinbio.botops.cloud/`                                            |
| 쿠키 모양            | 로그인 뒤 개발자 도구에서 `__Host-openclaw-session` 과 `Secure` 확인 (11.7 (다))   |
| 터널 연결            | `docker-compose ... logs cloudflared` 에 `Registered tunnel connection` 이 네 줄쯤 |
| 자동 배포            | `tail /volume1/docker/openclaw/deploy.log` 에 "변경 없음" 줄이 5분마다             |
| 메모리               | `sudo ... docker stats --no-stream` 과 `free -m`                                   |

### 13.8 실측 (2026-09-08)

첫 설치를 그대로 밟은 결과다.

| 항목                    | 값                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Actions 소요            | ix-auth 이미지 1분 6초(캐시), 게이트웨이 이미지 15분 4초, 실행 전체 16분 9초                        |
| 이미지 크기             | 게이트웨이 4.71 GB(압축 1.70 GB, 레이어 30개), ix-auth 274 MB                                       |
| NAS 이미지 받기         | 게이트웨이 1개에 약 11분(내려받기 + 압축 해제). 2코어라 압축 해제가 대부분이다                      |
| 컨테이너                | `ix-auth-db` healthy, `ix-auth` healthy, `gateway` healthy, `cloudflared` running(헬스체크 없음)    |
| 메모리 (`docker stats`) | gateway 504 MiB/3 GiB, ix-auth 378 MiB/768 MiB, db 132 MiB/512 MiB, cloudflared 18 MiB/128 MiB      |
| 호스트 메모리           | 전체 9,806 MB 중 사용 1,815 MB, 여유 7,541 MB                                                       |
| 디스크                  | `/volume1` 2.9 TB 여유 그대로                                                                       |
| compose 네트워크        | `172.19.0.0/16`. `OPENCLAW_TRUSTED_PROXIES=172.16.0.0/12` 이 덮는다                                 |
| 외부 접속               | `curl -sI https://jinbio.botops.cloud/` -> `HTTP/1.1 200 OK`, `Server: cloudflare`                  |
| 쿠키                    | 로그인 뒤 `__Host-openclaw-session-csrf` 확인. `__Host-` 접두는 `Secure` 없이는 브라우저가 거부한다 |
| 계정                    | 사용자 관리 화면에 `admin@deploy.local`(시스템 관리자) 1명. 시드 계정 없음                          |
| 터널                    | cloudflared 로그에 `Registered tunnel connection` 4줄, ingress 가 `http://gateway:18789`            |
| cron                    | `deploy.log` 에 5분 간격 "변경 없음" 줄. `--force` 는 "OK: 배포 완료 (헬스까지 0초)"                |

### 13.9 이 배치의 한계

- **NAS 직접 설치는 PoC 다**(11.6). 문서 변환 한 번에 2코어가 포화되고 그동안 NAS 본래의 파일 서비스가 함께 느려진다. 상시 운영은 별도 x86 호스트를 권한다.
- 도메인과 터널은 감독 개인 Cloudflare 계정의 것이다. 정식 납품 때 고객 도메인·계정으로 옮긴다. 바뀌는 것은 `OPENCLAW_PUBLIC_ORIGIN` 과 터널 토큰뿐이다.
- `OPENCLAW_NAS_ROOT` 가 아직 샘플 트리를 가리킨다. 실제 공유 폴더 매핑은 11.4 절차로 따로 한다.
- 모델 API 키가 비어 있어 부서 에이전트(rnd-bot·qa-bot)는 답하지 못한다. 절차는 3.4 (라).
- 이미지 태그 `chris-main` 은 브랜치를 따라 움직인다. 검증하지 않은 커밋을 `chris/main` 에 올리면 5분 안에 납품 호스트에 반영된다. 게이트(`pnpm check` + 라이브 실측)를 통과한 것만 머지한다.

## 용어 설명

1. <a id="g1"></a>**게이트웨이** - 모든 요청이 먼저 닿는 앞단 서버. 이 제품에서는 화면·인증·에이전트 실행을 한꺼번에 맡는 본체다.
2. <a id="g2"></a>**토큰** - 여기서는 신원을 증명하는 문자열. 가진 쪽은 그 신원으로 접속할 수 있으므로 비밀번호처럼 다룬다.
3. <a id="g3"></a>**임베딩** - 문장을 숫자 배열로 바꿔 뜻이 가까운 것끼리 가깝게 놓는 변환. 단어가 겹치지 않아도 뜻이 비슷하면 검색에 걸린다.
4. <a id="g4"></a>**도구 호출** - 모델이 정해진 함수를 골라 인자를 채워 부르는 동작. 파일 읽기나 검색이 이 방식으로 일어난다.
5. <a id="g5"></a>**컨텍스트** - 여기서는 브라우저가 판단하는 접속의 안전 여부(보안 컨텍스트). TLS 접속과 루프백 주소가 여기에 든다.
