# 납품 설치 절차서 (IX-Auth 로그인 스택)

> 게이트웨이 + IX-Auth 신원 서버 + PostgreSQL 을 컨테이너 3개로 세우는 절차다.\
> 모드 자체의 정본은 [AUTH-IXAUTH.md](AUTH-IXAUTH.md), 벤더 트리 취급은 [ix-auth/VENDOR.md](../ix-auth/VENDOR.md)·[ix-auth/MODULE.md](../ix-auth/MODULE.md).
>
> 작성 2026-09-07 (KST, 일요일).

---

## 0. 이 문서의 가정 (사용자 미확정)

아래 6가지는 감독 판단으로 정한 기본값이다. 고객 요건이 다르면 바꾸고, 바꾼 값을 이 문서에 적는다.

| #   | 가정                                                                                                              | 바꾸려면                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 관리 콘솔은 **외부에 포트를 열지 않는다.** 게이트웨이 경로 `/admin/identity/` 로만 superadmin·admin 에게 중계한다 | 별도 호스트명으로 띄우려면 `gateway.auth.ixAuth.adminConsoleUrl` 에 절대 URL 을 넣는다. 그때는 IP allowlist 나 VPN 이 반드시 앞에 있어야 한다 |
| 2   | 역할 5단계 `SUPERADMIN`/`ADMIN`/`EXECUTIVE`/`MODERATOR`/`MEMBER` 를 **기동 시 마이그레이션으로 시드**한다         | 고객이 자기 역할 체계를 쓰면 `gateway.auth.ixAuth.roleMap` 을 그 코드에 맞춘다                                                                |
| 3   | DB 는 **PostgreSQL 16**                                                                                           | MariaDB·MySQL 8 도 서버가 지원한다. `IXAUTH_DB_URL` 을 바꾸고 compose 의 `ix-auth-db` 를 교체한다                                             |
| 4   | 한국어 로케일은 `pnpm ui:i18n:sync` 로 채운다                                                                     | 다른 언어를 쓰면 브라우저 언어 설정을 따른다. ko 외 로케일은 아직 영어 폴백이다 (7절)                                                         |
| 5   | 호스트 포트는 **18800**                                                                                           | `.env` 의 `OPENCLAW_GATEWAY_PORT` 와 `OPENCLAW_PUBLIC_ORIGIN` 을 함께 바꾼다                                                                  |
| 6   | 부서 강제를 **켠 채로** 납품한다 (`tools.sessions.visibility: "department"`, 부서 코드 `dept-<slug>`)             | 부서를 안 쓰는 고객이면 그 값을 `"self"` 로 되돌린다. 접두사는 `gateway.auth.ixAuth.departmentGroupPrefix` (AUTH-DEPARTMENTS.md 4·5절)        |

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

| 변수                                    | 필수   | 기본값                                | 설명                                                                                                                            |
| --------------------------------------- | ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `IXAUTH_DB_NAME`                        |        | `ixauth`                              | PostgreSQL 데이터베이스 이름                                                                                                    |
| `IXAUTH_DB_USERNAME`                    |        | `ixauth`                              | DB 사용자                                                                                                                       |
| `IXAUTH_DB_PASSWORD`                    | **예** |                                       | DB 비밀번호. `openssl rand -base64 24`                                                                                          |
| `IXAUTH_SERVICE_KEY`                    | **예** |                                       | 게이트웨이와 신원 서버의 공유 비밀. **32자 이상**이어야 서버가 뜬다. `openssl rand -base64 36`. 브라우저에는 절대 나가지 않는다 |
| `IXAUTH_ADMIN_EMAIL`                    | **예** |                                       | 최초 관리자 이메일. 첫 부팅에만 시드되고 `SUPERADMIN` 을 받는다                                                                 |
| `IXAUTH_ADMIN_PASSWORD`                 | **예** |                                       | 최초 관리자 비밀번호. 아래 비밀번호 정책을 만족해야 한다                                                                        |
| `IXAUTH_ADMIN_NAME`                     |        | `관리자`                              | 콘솔에 보이는 표시 이름                                                                                                         |
| `IXAUTH_PASSWORD_MIN_LENGTH`            |        | `10`                                  | 최소 길이. 대문자·숫자·특수문자 각 1개 이상은 서버 기본값으로 항상 요구된다                                                     |
| `IXAUTH_LOG_LEVEL`                      |        | `INFO`                                | 신원 서버 로그 수준                                                                                                             |
| `IXAUTH_ACCOUNT_SIGNUP_MODE`            |        | `CLOSED`                              | 자체 가입 모드. 계정은 관리자가 만든다. `OPEN`·`APPROVAL` 은 메일이 먼저 있어야 한다                                            |
| `IXAUTH_ACCOUNT_SIGNUP_VERIFICATION`    |        | `EMAIL`                               | 가입 본인확인. `EMAIL` 인증 메일 / `NONE` 생략 / `PASS` 별도 연동                                                               |
| `IXAUTH_ACCOUNT_SIGNUP_ALLOWED_DOMAINS` |        | (없음)                                | 가입 허용 도메인. 쉼표로 구분. 비우면 제한 없음. 초대에는 적용되지 않는다                                                       |
| `IXAUTH_ACCOUNT_INVITE_TOKEN_TTL`       |        | `72h`                                 | 초대 링크 수명. 원본 기본값 `7d` 에서 줄였다                                                                                    |
| `IXAUTH_MAIL_TRANSPORT`                 |        | `WEBHOOK`                             | `WEBHOOK` 게이트웨이가 초대 링크를 보관 / `SMTP` 실제 발송 / `LOG` 개발용. 자세한 것은 AUTH-SIGNUP.md 6.1                       |
| `IXAUTH_MAIL_WEBHOOK_URL`               |        | `http://gateway:18789/auth/mail-hook` | WEBHOOK 일 때만 읽는다. 컴포즈 네트워크 주소이지 브라우저 오리진이 아니다                                                       |
| `IXAUTH_MAIL_FROM`                      |        | `no-reply@localhost`                  | 보내는 사람                                                                                                                     |
| `IXAUTH_MAIL_PRODUCT_NAME`              |        | `Chris Agent`                         | 메일 제목·본문에 쓰는 제품명                                                                                                    |
| `IXAUTH_MAIL_SMTP_HOST`                 |        |                                       | SMTP 서버. `IXAUTH_MAIL_TRANSPORT=SMTP` 일 때만 읽는다                                                                          |
| `IXAUTH_MAIL_SMTP_PORT`                 |        | `587`                                 | SMTP 포트                                                                                                                       |
| `IXAUTH_MAIL_SMTP_USERNAME`             |        |                                       | 비우면 인증 없이 보낸다                                                                                                         |
| `IXAUTH_MAIL_SMTP_PASSWORD`             |        |                                       | 위와 같다                                                                                                                       |
| `IXAUTH_MAIL_SMTP_STARTTLS`             |        | `true`                                | STARTTLS 사용 여부                                                                                                              |
| `MAILPIT_UI_PORT`                       |        | `18025`                               | 개발용 수신함(`--profile mail`)의 호스트 포트                                                                                   |
| `OPENCLAW_GATEWAY_PORT`                 |        | `18800`                               | 호스트에 여는 포트                                                                                                              |
| `OPENCLAW_PUBLIC_ORIGIN`                |        | `http://127.0.0.1:18800`              | **브라우저가 실제로 쓰는 오리진.** 스킴·포트 포함, 끝에 `/` 없이. `gateway.controlUi.allowedOrigins` 로 들어간다                |
| `OPENCLAW_TZ`                           |        | `Asia/Seoul`                          | 컨테이너 시간대                                                                                                                 |
| `ANTHROPIC_API_KEY`                     |        | (없음)                                | 외부 모델 API 키. 사내 ollama 만 쓰면 비워 둔다. 설정 파일에는 `"${ANTHROPIC_API_KEY}"` 이름만 적는다 (3.4)                     |
| `OPENAI_API_KEY`                        |        | (없음)                                | 위와 같다. 두 키 모두 비면 모델 목록이 비고 화면에 "사용 가능한 모델 없음" 이 뜬다                                              |

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
2. Flyway 마이그레이션 (`V1`~`V15`)
3. **역할 5종 시드** (`V14` 가 4종, `V15` 가 `EXECUTIVE`. `SUPERADMIN` 에는 `ixauth:*:*` 권한도 함께 준다)
4. 서명 키 생성 + **최초 관리자 1명 시드**(`SUPERADMIN` 부여)
5. 게이트웨이가 `ixauth-gateway-config/openclaw.json` 을 상태 볼륨에 렌더링하고 `--bind lan` 으로 기동

`http://<OPENCLAW_PUBLIC_ORIGIN>` 을 열면 로그인 화면이 뜬다. 토큰도 기기 페어링도 없다.

> **`__Host-` 쿠키 주의.** HTTPS 가 아니고 루프백도 아닌 주소로 접근하면 브라우저가 세션 쿠키를 저장하지 않는다. 로컬 검증은 반드시 `http://127.0.0.1:18800` 으로 하고(`localhost` 는 다른 이름이라 오리진이 어긋난다), 실배포는 TLS 뒤에 둔다.

### 3.1 첫 로그인 직후 할 일 (운영 지시)

IX-Auth 에는 "첫 로그인 시 비밀번호 변경 강제" 기능이 **없다.** 통제 장치가 아니라 절차로 지킨다.

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

링크는 감추는 것이 아니라 **응답 본문에 싣지 않는다.** 주소를 직접 입력해도 403 이다.

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

모델과 임베딩을 전부 사내에서 끝낸다. compose 에 서비스를 하나 더 붙인다.

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

- `baseUrl` 에 **`/v1` 을 붙이지 마라.** OpenAI 호환 경로는 도구 호출을 깨뜨려서 모델이 도구 호출 JSON 을 본문에 그대로 뱉는다.
- 루프백·사설망·컨테이너 이름 주소는 토큰이 필요 없다. 게이트웨이가 `ollama-local` 표식을 쓴다.
- 모델은 미리 받아 둔다: `docker compose ... exec ollama ollama pull qwen4:32b`, 임베딩은 `ollama pull bge-m3`.
- 임베딩 모델을 바꾸면 색인 정체성이 달라진다. 반드시 3.5 의 재색인을 돌린다.
- GPU 가 있으면 compose 서비스에 `deploy.resources.reservations.devices` 로 넘긴다. 없으면 CPU 로도 뜨지만 응답이 느리다.

#### (다) ChatGPT 구독(Codex OAuth) 방식

API 키를 따로 사지 않고, 이미 있는 ChatGPT 유료 구독 계정으로 붙인다. 자격증명은 API 키가 아니라 OAuth 프로필이라 `.env` 에도 설정 파일에도 쓰지 않는다. 상태 볼륨의 인증 저장소(`/home/node/.openclaw/state/openclaw.sqlite`)에 들어가고, 컨테이너를 다시 만들어도 볼륨이 살아 있는 한 유지된다.

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

## 4. 백업 · 복구

볼륨 2개가 상태의 전부다.

| 볼륨                              | 담는 것                                                       | 잃으면                                                      |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| `openclaw-ixauth_ix-auth-db-data` | 계정·역할·세션·감사 원장·서명 키                              | 계정을 전부 다시 만든다                                     |
| `openclaw-ixauth_gateway-state`   | 게이트웨이 SQLite(프로필·로그인 세션·부서·대화), 워크스페이스 | 대화 이력·로그인 세션과 **에이전트 부서 바인딩**이 사라진다 |

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

## 8. 라이선스 확인 항목 (납품 전 법무 확인 필요)

| 대상                                    | 라이선스                       | 상태                    |
| --------------------------------------- | ------------------------------ | ----------------------- |
| **IX-Auth** (`ix-auth/`)                | `package.json` 이 `UNLICENSED` | **미해결.** 아래        |
| 게이트웨이                              | MIT                            | 문제 없음               |
| `postgres:16-alpine`                    | PostgreSQL License (BSD 계열)  | 문제 없음               |
| Chromium (`OPENCLAW_INSTALL_BROWSER=1`) | BSD 계열 + 다수                | 고지 의무 확인          |
| Noto CJK 폰트                           | SIL OFL 1.1                    | 재배포 시 라이선스 동봉 |

**IX-Auth 는 사내 제품이고 `UNLICENSED` 로 표기돼 있다.** 이 상태로 외부 고객에게 이미지를 넘기면 배포 권원이 문서로 남지 않는다. 납품 전에 확정해야 할 것:

1. 이 포크에 IX-Auth 를 동봉해 배포할 권한이 있는가 (사내 제품이라도 명시적 허가가 문서에 남아야 한다).
2. 고객이 받는 것이 사용권인가 소스 포함인가.
3. 상용 라이선스가 필요한 배포 형태인가 (`ix-auth/VENDOR.md` 의 원본 저장소 정책과 대조).

이 항목은 **기술로 해결되지 않는다.** 사용자 결정 사항으로 남긴다.

## 9. 진단

| 증상                                           | 확인                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `up -d` 후 게이트웨이가 계속 재시작한다        | `docker compose ... logs gateway`. 설정 오류면 `Gateway start blocked:` 로 시작하는 줄이 이유를 말한다    |
| 로그인 폼에서 403 `origin_not_allowed`         | `OPENCLAW_PUBLIC_ORIGIN` 이 브라우저 주소창의 오리진과 글자 그대로 같은지. 다시 기동해야 반영된다         |
| 로그인 200 인데 바로 로그아웃된다              | issuer/audience 불일치. 이 스택에서는 양쪽에 박혀 있으므로, 설정 파일을 손댔다면 되돌린다                 |
| 쿠키가 아예 저장되지 않는다                    | HTTPS 도 루프백도 아닌 주소. `__Host-` 쿠키는 그런 곳에 저장되지 않는다                                   |
| 로그인은 되는데 "승인되지 않은 기기" 로 끊긴다 | 이 모드는 기기 페어링을 요구하지 않는다. 이 메시지가 보이면 이미지가 구버전이다                           |
| 사용자 관리가 403                              | 그 계정의 역할이 `superadmin`·`admin` 이 아니다. 설정 > 사용자 에서 역할을 바꾼다(세션은 자동으로 끊긴다) |
| 콘솔에서 저장이 403 `csrf_mismatch`            | 게이트웨이 세션이 만료됐다. Control UI 탭을 새로 고쳐 로그인한 뒤 콘솔을 다시 연다                        |
| 신원 서버가 뜨지 않는다                        | `IXAUTH_SERVICE_KEY` 가 32자 미만이면 부팅을 거부한다                                                     |
| 나머지                                         | [AUTH-IXAUTH.md](AUTH-IXAUTH.md) 7.4                                                                      |

## 10. 확인된 제약

| 제약                | 내용                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 역할 변경 반영 지연 | 콘솔에서 역할만 바꾸면 최대 15분 늦게 반영된다. 즉시 반영하려면 세션도 함께 종료한다 (AUTH-IXAUTH.md 7.3)         |
| 부서 접근 강제      | **구현됨**(B 단계). 로컬 CLI `agents list`·`sessions` 는 게이트웨이를 안 타므로 경계 밖이다 (호스트 셸 = 경계 밖) |
| 초대장 가입 화면    | 미구현. 계정은 콘솔에서 만든다                                                                                    |
| ko 외 로케일        | 번역 제공자 없이 동기화해 영어 폴백 상태다. `pnpm ui:i18n:check` 가 그 때문에 실패한다                            |
| 메일                | SMTP 설정이 없다. 비밀번호 재설정·초대 메일은 보내지지 않는다                                                     |
