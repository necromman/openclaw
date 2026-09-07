# 초대장·가입 플로우 정본

> 이 문서가 포크의 계정 생성 경로 정본이다. 로그인·세션은 [AUTH-IXAUTH.md](AUTH-IXAUTH.md),
> 부서 경계는 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md), 설치는 [DEPLOY.md](DEPLOY.md).
>
> 작성 2026-09-07 (KST, 일요일). 구현 범위 = C 단계.

---

## 1. 한 문단 요약

계정이 생기는 길은 둘뿐이다. **관리자가 초대장을 발급**하면 받는 사람이 링크에서 비밀번호를 정하고 즉시 활성이 된다. **자기 가입을 연 배포**에서는 신청 -> 이메일 인증 -> 관리자 승인을 거쳐야 로그인할 수 있다. 어느 쪽이든 토큰의 진위·만료·재사용 판정은 전부 IX-Auth 가 하고, 게이트웨이는 브라우저와 IX-Auth 사이에서 **토큰을 중계만** 한다 (AUTH-IXAUTH 6.2 3항). 두 길 중 무엇이 열려 있는지는 `.env` 한 줄(`IXAUTH_ACCOUNT_SIGNUP_MODE`)이 정하고, 그 값이 IX-Auth 와 게이트웨이 양쪽에 동시에 적용된다.

## 2. 두 경로

### 2.1 초대장 (기본)

```text
1. 관리자가 설정 > 연결 화면에서 이메일·이름·역할·부서를 넣고 "초대"
2. 게이트웨이 -> IX-Auth  POST /admin/users {email,name,roles,invite:true}
      Authorization: Bearer <그 관리자 본인의 access token>
      비밀번호를 보내지 않는 것이 곧 초대 방식이다. 계정은 PENDING 으로 생긴다
3. 부서를 골랐으면 GET /admin/groups 로 dept- 코드를 찾아
      POST /admin/groups/{id}/members {userId}
      -> 초대 시점에 그룹 가입이 끝나므로 첫 로그인부터 부서가 붙는다
4. IX-Auth 가 초대 메일을 만든다
      transport=SMTP  -> 실제 발송. 게이트웨이는 아무것도 보관하지 않는다
      transport=WEBHOOK -> POST {게이트웨이}/auth/mail-hook 으로 링크가 넘어온다
5. 관리자 화면이 그 링크를 보여준다 (SMTP 배포에서는 "발송했다" 만 표시)
6. 받는 사람이 /accept-invite?token=... 을 연다
      -> POST /auth/invite/accept {token,password,name}
      -> IX-Auth 가 PENDING -> ACTIVE 로 올리고 이메일을 인증됨으로 표시
7. 로그인
```

**초대가 곧 승인이다.** 수락 후 관리자가 다시 눌러야 할 것은 없다.

### 2.2 자기 가입 -> 승인

`IXAUTH_ACCOUNT_SIGNUP_MODE=APPROVAL` + `IXAUTH_ACCOUNT_SIGNUP_VERIFICATION=EMAIL` + 동작하는 SMTP 가 전제다.

```text
1. 방문자가 /signup 에서 이메일·이름·비밀번호를 넣는다
2. 게이트웨이 -> IX-Auth  POST /auth/signup   (서비스 키)
      -> 계정이 PENDING_APPROVAL 로 생기고 인증 메일이 나간다
      -> 이미 있는 주소면 계정을 만들지 않고 그 주소의 주인에게만 알린다.
         응답은 두 경우가 완전히 같다 (4절)
3. 방문자가 메일의 /verify-email?token=... 을 연다
      -> POST /auth/email/verify {token}
      -> "주소 확인됨. 관리자 승인 대기" 안내
4. 관리자가 설정 > 연결 화면의 "가입 승인" 목록에서 승인 또는 거절
      -> POST /auth/admin/signup-approvals {userId,decision}
      -> 게이트웨이 -> IX-Auth  POST /admin/signup-approvals/{id}/approve
      승인 시 부서를 함께 지정할 수 있다 (그룹 가입까지 처리)
5. 승인되면 PENDING_APPROVAL -> ACTIVE, 승인 알림 메일이 나가고 로그인 가능
   거절하면 DISABLED 로 남는다. 계정을 지우지 않는 이유는 같은 주소로 반복
   시도하는 것을 막고 거절 이력을 남기기 위해서다 (IX-Auth 설계)
```

**승인 전 로그인 시도**는 IX-Auth 가 403 `AUTH_ACCOUNT_PENDING_APPROVAL` 로 막고, 로그인 화면이 "관리자 승인 대기 중" 으로 표시한다. 이것이 "승인 대기 화면" 이다. 대기 상태를 조회하는 별도 API 를 만들지 않았다 - 그런 조회는 그 자체가 계정 존재 여부를 알려 주는 창구가 된다.

## 3. 설정 키

### 3.1 IX-Auth 쪽 (`chris-local/ixauth.env`)

| 키                                              | 기본값                                | 뜻                                                                                                          |
| ----------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `IXAUTH_ACCOUNT_SIGNUP_MODE`                    | `CLOSED`                              | `CLOSED` 초대 전용 / `APPROVAL` 승인제 / `OPEN` 즉시. **이 한 값이 게이트웨이의 가입 화면 노출까지 정한다** |
| `IXAUTH_ACCOUNT_SIGNUP_VERIFICATION`            | `EMAIL`                               | `EMAIL` 인증 메일 / `NONE` 생략 / `PASS` 별도 연동                                                          |
| `IXAUTH_ACCOUNT_SIGNUP_ALLOWED_DOMAINS`         | (없음)                                | 쉼표로 구분한 허용 도메인. 비우면 제한 없음                                                                 |
| `IXAUTH_ACCOUNT_INVITE_TOKEN_TTL`               | `72h`                                 | 초대 링크 수명. 원본 기본값은 `7d` 인데 이 배포는 3일로 줄였다                                              |
| `IXAUTH_MAIL_TRANSPORT`                         | `WEBHOOK`                             | `WEBHOOK` 게이트웨이가 초대 링크를 보관 / `SMTP` 실제 발송 / `LOG` 개발용                                   |
| `IXAUTH_MAIL_WEBHOOK_URL`                       | `http://gateway:18789/auth/mail-hook` | WEBHOOK 일 때만 읽는다. 컴포즈 네트워크 주소이지 브라우저 오리진이 아니다                                   |
| `IXAUTH_MAIL_APP_BASE_URL`                      | `OPENCLAW_PUBLIC_ORIGIN`              | 메일 링크가 가리킬 **앱** 주소                                                                              |
| `IXAUTH_MAIL_SMTP_HOST` 외                      | (없음)                                | SMTP 일 때만 읽는다                                                                                         |
| `IXAUTH_MAIL_FROM` · `IXAUTH_MAIL_PRODUCT_NAME` | `no-reply@localhost` · `Chris Agent`  | 메일 헤더·본문 표기                                                                                         |

경로 3개(`reset-path` `/reset-password`, `verify-path` `/verify-email`, `invite-path` `/accept-invite`)는 IX-Auth 기본값을 그대로 쓴다. 포크의 화면 경로가 같은 이름이라 바꿀 이유가 없다.

### 3.2 게이트웨이 쪽

`gateway.auth.ixAuth.selfSignup` (boolean, 기본 `false`) 하나가 추가됐다. 가입 화면을 내보낼지 정한다.

**운영자가 이 값을 직접 쓰지 않는다.** `chris-local/ixauth-gateway-config/start-gateway.sh` 가 `IXAUTH_ACCOUNT_SIGNUP_MODE` 에서 유도한다(`OPEN`·`APPROVAL` 이면 `true`). 두 곳을 손으로 맞추게 두면 "가입 화면은 있는데 누르면 거부" 라는 상태가 생기고, 그것은 방문자에게 고장으로 읽힌다.

> **가정(사용자 미확정)**: 설정 키를 하나 늘리는 판단. IX-Auth 에는 가입 모드를 밖에서 물어볼 수 있는 공개 엔드포인트가 없어서(로그인 전 화면이 알아야 하는데 `/admin/settings` 는 관리자 토큰을 요구한다) 게이트웨이가 스스로 알아낼 방법이 없다. 대신 배포에서 단일 `.env` 변수로 묶어 실질 노브 개수는 늘리지 않았다.

## 4. 이메일 열거 방지

**같은 질문에 같은 대답을 한다.** 존재하는 주소와 존재하지 않는 주소에 대해 상태 코드와 응답 본문이 바이트 단위로 같다.

| 표면                         | 응답                    |
| ---------------------------- | ----------------------- |
| `POST /auth/signup`          | 200 `{"accepted":true}` |
| `POST /auth/password/forgot` | 200 `{"accepted":true}` |

이것이 가능한 이유는 IX-Auth 가 이미 그렇게 설계돼 있기 때문이다. 이미 있는 주소로 가입을 시도하면 계정을 만들지 않고 **그 주소의 주인에게만** "이미 계정이 있다" 메일을 보낸 뒤, 신규 가입과 똑같은 `{accepted:true}` 를 답한다. 게이트웨이는 그 응답을 그대로 옮기고, 상수 하나(`IX_AUTH_REQUEST_ACCEPTED`)로 직렬화하므로 두 경로에서 다른 본문이 나올 수 없다.

같은 원칙이 토큰 표면에도 적용된다.

| 상황                | 응답                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| 만료된 토큰         | 400 `{"error":"invalid_token", "message":"This link is no longer valid. Ask for a new one."}` |
| 이미 쓴 토큰        | 위와 동일                                                                                     |
| 존재한 적 없는 토큰 | 위와 동일                                                                                     |

셋을 구분해 주면 링크를 추측하는 쪽에 "어느 추측이 가까웠는지" 를 알려 주게 된다. 예외는 **비밀번호 정책 위반** 하나다 - 그때는 400 `password_rejected` 로 IX-Auth 의 문구를 그대로 전달한다. 규칙은 설정 값이라 게이트웨이가 모르고, 사용자는 "다시 적으면 되는 일" 이라는 것을 알아야 한다. IX-Auth 도 이 경우 토큰을 소모하지 않는다.

B 단계가 세션 열람 거부를 403 이 아니라 404 로 답해 키 존재를 감춘 것과 같은 판단이다.

로그인 실패 응답은 A 단계부터 이미 단일 문구(`IX_AUTH_INVALID_CREDENTIALS`)다.

## 5. 화면 목록

로그인 전 화면은 전부 **주소로 결정된다.** 라우터는 연결이 선 뒤에야 도는데 이 화면들은 그 전에 떠야 하기 때문이다 (`ui/src/features/ix-auth/ix-auth-account-screen.ts`).

| 경로                     | 화면                    | 조건                                                                                                           |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/` (그 밖 전부)         | 로그인                  | 항상                                                                                                           |
| `/signup`                | 가입 신청               | `selfSignup` 이 true 일 때만 링크가 보인다. false 면 로그인 화면에 "초대를 받아야 가입할 수 있다" 가 대신 뜬다 |
| `/forgot-password`       | 비밀번호 찾기           | 항상                                                                                                           |
| `/reset-password?token=` | 비밀번호 재설정         | 토큰 없으면 "링크가 불완전하다"                                                                                |
| `/verify-email?token=`   | 이메일 인증 도착        | 위와 같다                                                                                                      |
| `/accept-invite?token=`  | 초대 수락·비밀번호 설정 | 위와 같다                                                                                                      |

관리자 화면 2개는 **설정 > 연결** 페이지에 붙는다 (`ui/src/pages/connection/ix-auth-invite-section.ts`). 라우트 테이블을 건드리지 않는 것은 업스트림 리베이스 비용 때문이다 (FORK.md 5-B 와 같은 판단).

| 블록      | 내용                                                                       |
| --------- | -------------------------------------------------------------------------- |
| 초대      | 이메일·이름·역할·부서 입력, 발급 버튼, 보관 중인 초대 링크 목록(복사·삭제) |
| 가입 승인 | 대기 목록, 승인·거절                                                       |

**역할 선택지는 직원·임원·관리자 3개**이고, superadmin 으로 로그인한 사람에게만 "시스템 관리자"
가 하나 더 붙는다. `MODERATOR` 는 서버가 계속 받아들이지만(기존 계정·손으로 쓴 설정 호환) 고를
수 있는 목록에서는 뺐다. 아무도 고르지 않아야 할 항목을 목록에 두면 잘못 고를 길만 생긴다.

**부서는 여러 개 고를 수 있다.** 체크박스 목록이고 하나도 안 고를 수 있다. 역할을 임원으로 바꾸면
전체 부서가 자동으로 체크되며, 그중 일부를 해제해도 된다 - 자동 체크는 출발점이지 규칙이 아니다.
**임원 초대에서 부서를 하나도 남기지 않으면 게이트웨이가 전 부서를 채운다.** 그 목록은 브라우저가
보낸 값이 아니라 `GET /auth/admin/departments` 와 같은 소스(IX-Auth 그룹 목록의 `dept-` 접두 코드)
에서 다시 읽는다. 요청 본문이 부서 목록을 지어낼 수 없다는 뜻이다.

두 블록은 `/auth/me` 응답에 관리 콘솔 링크가 실린 세션에만 렌더된다. 그 링크는 게이트웨이가 superadmin·admin 에게만 실어 보내므로, 화면에서 감추는 것이 아니라 애초에 오지 않는다. 감춤은 방어가 아니므로 **게이트웨이가 별도로 역할을 다시 판정한다** (6절).

## 6. 게이트웨이 표면

기존 `/auth/*` 비 admitted stage 를 그대로 쓴다. 새 병렬 경로를 만들지 않았다.

| 메서드          | 경로                           | 인가                           | 레이트리밋 |
| --------------- | ------------------------------ | ------------------------------ | ---------- |
| POST            | `/auth/signup`                 | 없음 (Origin 검사)             | IP         |
| POST            | `/auth/password/forgot`        | 없음 (Origin 검사)             | IP         |
| POST            | `/auth/password/reset`         | 없음 (Origin 검사)             | IP         |
| POST            | `/auth/email/verify`           | 없음 (Origin 검사)             | IP         |
| POST            | `/auth/invite/accept`          | 없음 (Origin 검사)             | IP         |
| POST            | `/auth/mail-hook`              | **서비스 키** (`X-IxAuth-Key`) | 없음       |
| GET·POST·DELETE | `/auth/admin/invites`          | 세션 + superadmin·admin + CSRF | 없음       |
| GET·POST        | `/auth/admin/signup-approvals` | 세션 + superadmin·admin + CSRF | 없음       |
| GET             | `/auth/admin/departments`      | 세션 + superadmin·admin        | 없음       |

규칙 몇 가지:

- **레이트리밋은 로그인과 같은 버킷**(`shared-secret`)이다. 같은 추측 표면을 다른 문으로 두드리는 것이라, 문마다 새 할당량을 주면 리미터가 무의미해진다.
- **`mail-hook` 만 Origin 검사를 하지 않는다.** 브라우저가 부르는 경로가 아니라 IX-Auth 가 부르는 경로다. 대신 서비스 키를 상수 시간 비교로 검사하고, 무슨 일이 있었든 204 로 답한다. 무엇을 보관했는지 알려 주면 그것으로 탐색할 수 있다.
- **관리자 표면은 세션에 담긴 그 관리자의 IX-Auth access token 으로 IX-Auth 를 부른다.** 서비스 키를 쓰면 게이트웨이 버그 하나가 member 를 관리자로 만들 수 있고, IX-Auth 원장에 "게이트웨이가 했다" 로 남는다. 지금은 IX-Auth 가 `ixauth:users:write` 를 한 번 더 검사하고 원장에 실제 사람이 남는다.
- **권한 상승 차단**: `superAdminRoles` 에 매핑되는 역할(기본 `SUPERADMIN`)은 superadmin 세션만 초대할 수 있다. admin 이 자기보다 높은 계정을 만들어 그것으로 로그인하는 길을 막는다. 임원(`EXECUTIVE`)은 여기에 걸리지 않는다 - 관리자의 책무이고, 임원은 관리 권한을 하나도 얻지 못한다.
- **부서 필드는 두 가지를 다 받는다**: `departments: string[]` 이 정본이고, 예전 단일 필드 `department` 는 호환용으로 남아 같은 목록에 합쳐진다. 어느 쪽이든 `dept-` 접두가 아닌 그룹 코드는 거부된다(부서가 아닌 그룹에 사람을 몰래 넣을 수 없다). 응답은 `departments`(실제로 붙은 부서)와 `departmentFailed` 를 함께 낸다.

### 6.1 초대 링크 보관 (`mail-hook`)

SMTP 가 없는 배포에서 관리자가 링크를 손에 넣는 유일한 방법이다. IX-Auth 의 `mail.transport: WEBHOOK` 을 게이트웨이 자신에게 겨눠, 나갔어야 할 메일을 받아 **`kind: "INVITE"` 인 것만** 메모리에 보관한다.

| 항목      | 값                                                                               |
| --------- | -------------------------------------------------------------------------------- |
| 보관 대상 | 초대(`INVITE`)뿐                                                                 |
| 버리는 것 | `PASSWORD_RESET` · `MAGIC_LINK` · `EMAIL_VERIFY` 등 전부. 로그에도 남기지 않는다 |
| 수명      | 72시간 (초대 토큰 수명과 같다)                                                   |
| 상한      | 200건. 넘으면 오래된 것부터 버린다                                               |
| 저장 위치 | 프로세스 메모리. DB 에 쓰지 않는다                                               |

**비밀번호 재설정 링크와 매직 링크를 보관하지 않는 이유**는 그것이 그 자체로 자격증명이기 때문이다. 초대 링크는 아직 아무 계정도 아닌 것을 여는 열쇠이고, 그것을 볼 수 있는 사람은 이미 계정을 만들 수 있는 관리자다.

## 7. 부서와의 접점

**초대 발급 시점에 그룹 가입이 끝난다.** B 단계가 남긴 "새 계정은 첫 로그인 전까지 `department_members` 행이 없어 미배정으로 동작한다" 는 문제는 이 경로에서는 발생하지 않는다.

```text
초대: POST /admin/users -> userId -> GET /admin/groups -> POST /admin/groups/{id}/members
승인: POST /admin/signup-approvals/{id}/approve -> 같은 그룹 가입
```

그 뒤의 흐름은 B 단계 그대로다. 첫 로그인 때 access token 의 `ixauth_groups` 클레임에 `dept-` 코드가 실려 오고, 게이트웨이가 `department_members` 로 투영한다. 즉 **IX-Auth 가 정본, 포크 DB 는 투영**이라는 B 단계 원칙이 유지된다.

부서 지정이 실패해도(코드가 없거나 그룹 API 가 거부) **초대 자체는 취소하지 않는다.** 계정은 만들어졌고 링크는 이미 나갔기 때문이다. 응답의 `departmentFailed` 로 알리고 관리자가 콘솔에서 붙인다.

## 8. 운영 절차

### 8.1 초대 발급

1. superadmin·admin 으로 로그인 -> 설정 -> 연결
2. "초대" 블록에 이메일·이름·역할·부서를 넣고 발급 (부서는 여러 개 체크할 수 있고, 역할이 임원이면 전 부서가 미리 체크된다)
3. `IXAUTH_MAIL_TRANSPORT=WEBHOOK` 이면 화면에 링크가 뜬다. **그 링크를 직접 전달한다** (사내 메신저 등). 72시간 뒤 만료
4. `SMTP` 면 "발송했다" 만 뜬다. 링크는 화면에 남지 않는다
5. 전달이 끝나면 목록에서 "삭제" 로 지운다

### 8.2 재발급

같은 이메일로 다시 초대하면 IX-Auth 가 **같은 용도의 옛 토큰을 전부 무효화**하고 새 링크를 만든다. 화면의 링크도 새것으로 바뀐다. 옛 링크를 살려 두면 오래된 메일 한 통 유출로 계정을 빼앗긴다.

### 8.3 승인·거절

1. 설정 -> 연결 -> "가입 승인" 목록
2. 이메일 미인증 표시가 있으면 본인이 아직 링크를 누르지 않은 것이다. 승인해도 되지만 주소가 확인되지 않은 계정이 된다
3. 승인하면 즉시 로그인 가능. 거절하면 `DISABLED` 로 남고 같은 주소로 다시 가입할 수 없다

### 8.4 비밀번호 찾기

사용자가 로그인 화면의 "비밀번호를 잊었다" 를 누르고 주소를 넣는다. SMTP 가 없는 배포에서는 **메일이 나가지 않고 게이트웨이도 그 링크를 보관하지 않는다** (6.1). 그 배포에서는 관리자가 IX-Auth 콘솔의 비밀번호 재설정을 쓰거나 초대를 다시 보낸다. 화면 문구는 어느 경우에도 "계정이 있으면 링크가 갑니다" 로 같다.

### 8.5 도메인 제한

`IXAUTH_ACCOUNT_SIGNUP_ALLOWED_DOMAINS=prost.team` 처럼 넣으면 그 밖의 주소는 가입에서 400 `signup_rejected` 를 받는다. **초대에는 적용되지 않는다** - 관리자가 명시적으로 지정한 주소이기 때문이다.

## 9. 되돌리기

```text
1. IXAUTH_ACCOUNT_SIGNUP_MODE=CLOSED 로 되돌리면 가입 화면이 사라진다
   (게이트웨이 재시작 필요. start-gateway.sh 가 설정을 다시 렌더한다)
2. IXAUTH_MAIL_TRANSPORT=LOG 로 되돌리면 초대 링크 보관이 멈춘다.
   보관 중이던 링크는 프로세스 메모리에만 있으므로 재시작으로 사라진다
3. 화면·라우트 전체를 걷어내려면 이 단계의 커밋을 되돌린다.
   DB 스키마 변경이 없으므로 마이그레이션 되돌리기는 없다
4. 이미 만들어진 계정은 그대로 남는다. IX-Auth 콘솔에서 관리한다
```

**스키마 변경 없음.** 이 단계는 SQLite 테이블을 추가하거나 바꾸지 않았다. 초대 링크 보관은 메모리이고, 그 밖의 상태는 전부 IX-Auth 에 있다.

## 10. 파일 지도

### 10.1 신규

| 경로                                                | 역할                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `src/auth/ix-auth/ix-auth-account-client.ts`        | signup·forgot·reset·verify·invite accept 중계 (서비스 키)         |
| `src/auth/ix-auth/ix-auth-admin-client.ts`          | `/admin/*` 중계 (관리자 access token)                             |
| `src/gateway/ix-auth-http-shared.ts`                | deps 타입·Origin 규칙·본문 읽기·실패 매핑 (순환 참조 방지용 분리) |
| `src/gateway/ix-auth-account-http.ts`               | 익명 계정 표면 + mail-hook                                        |
| `src/gateway/ix-auth-admin-http.ts`                 | 관리자 표면 (초대·승인·부서)                                      |
| `src/gateway/ix-auth-invite-links.ts`               | 초대 링크 보관소 (메모리, 72시간, 200건)                          |
| `ui/src/features/ix-auth/ix-auth-account-api.ts`    | 익명 표면 클라이언트                                              |
| `ui/src/features/ix-auth/ix-auth-admin-api.ts`      | 관리자 표면 클라이언트                                            |
| `ui/src/features/ix-auth/ix-auth-account-screen.ts` | 주소 -> 화면 판정                                                 |
| `ui/src/components/ix-auth-form-fields.ts`          | 입력·비밀번호 필드 공용 템플릿                                    |
| `ui/src/components/ix-auth-account-form.ts`         | 가입·찾기·재설정·인증·수락 화면 본문                              |
| `ui/src/pages/connection/ix-auth-invite-section.ts` | 관리자 초대·승인 블록                                             |
| `chris-local/AUTH-SIGNUP.md`                        | 이 문서                                                           |

### 10.2 수정

| 경로                                                                                                                                   | 변경                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/config/types.gateway.ts` · `zod-schema.gateway.ts`                                                                                | `selfSignup`                                                              |
| `src/auth/ix-auth/ix-auth-types.ts` · `ix-auth-settings.ts`                                                                            | `selfSignupEnabled`                                                       |
| `src/auth/ix-auth/ix-auth-client.ts`                                                                                                   | `callIxAuthEndpoint` 공개 + GET·Bearer·배열 응답 지원                     |
| `src/gateway/ix-auth-http-paths.ts`                                                                                                    | 새 경로 9개 분류                                                          |
| `src/gateway/ix-auth-http.ts`                                                                                                          | 메서드 표·레이트리밋 헬퍼·새 모듈 위임, `/auth/me` 에 `selfSignupEnabled` |
| `ui/src/components/ix-auth-login.ts`                                                                                                   | 화면 전환 셸                                                              |
| `ui/src/features/ix-auth/ix-auth-form-state.ts` · `ix-auth-sign-in-step.ts` · `ix-auth-session-controller.ts` · `ix-auth-gate-view.ts` | 화면 상태·제출·이동                                                       |
| `ui/src/i18n/locales/en-ix-auth.ts`                                                                                                    | 문구                                                                      |
| `ui/src/styles/fork-style.css`                                                                                                         | 초대 링크 목록 줄바꿈 (6절)                                               |
| `chris-local/docker-compose.ixauth.yml` · `ixauth.env.example` · `ixauth-gateway-config/*`                                             | 메일·가입 설정, mailpit 프로파일                                          |

## 11. 라이브 검증 기록 (2026-09-07, compose 스택 18800)

검증 구성: `chris-local/docker-compose.ixauth.yml`. 경로 1은 `IXAUTH_MAIL_TRANSPORT=WEBHOOK` + `SIGNUP_MODE=CLOSED`, 경로 2는 `SMTP`(mailpit 프로파일) + `SIGNUP_MODE=APPROVAL` + `SIGNUP_VERIFICATION=EMAIL` 로 각각 재기동해 확인했다.

| #   | 시나리오                      | 결과                                                                                              |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | 초대 발급 (관리자, 부서 지정) | 통과. `POST /admin/users` -> 그룹 가입 -> 메일 훅으로 링크 수신. 관리자 화면에 링크가 그대로 떴다 |
| 2   | 초대 수락                     | 통과. 시크릿 창에서 비밀번호 설정, "계정이 준비됐습니다"                                          |
| 3   | 초대받은 계정 로그인          | 통과. `member` 역할, **첫 로그인부터 `departments:["rnd"]`**. 초대 시점 그룹 가입이 실제로 먹었다 |
| 4   | 가입 신청                     | 통과. `{accepted:true}`, mailpit 에 "이메일 주소 확인" 도착                                       |
| 5   | 이메일 인증                   | 통과. "주소를 확인했습니다. 이제 관리자 승인을 기다립니다"                                        |
| 6   | 승인 전 로그인                | 통과. 403 `AUTH_ACCOUNT_PENDING_APPROVAL` -> "관리자 승인을 기다리는 계정입니다"                  |
| 7   | 관리자 승인 (부서 지정)       | 통과. 목록에서 사라지고, 승인 계정이 `departments:["qa"]` 로 로그인                               |
| 8   | 관리자 거절                   | 통과. 목록에서 사라지고 로그인은 403 `account_disabled`                                           |
| 9   | 비밀번호 찾기·재설정          | 통과. mailpit 링크 -> 새 비밀번호 설정 -> 새 비밀번호로 로그인 200                                |
| 10  | 역할 게이트                   | 통과. member 세션이 관리자 표면 3개를 부르면 전부 403 `forbidden`                                 |
| 11  | 이메일 열거 방지              | 통과(본문·상태). 12절 아래 참조                                                                   |
| 12  | 레이트리밋                    | 통과. 가입을 연달아 던지면 4회째부터 429. 로그인과 같은 버킷이라 별도 할당량이 생기지 않는다      |

로그: `D:\PROJECT\chris-servernalysis6-09-07-openclaw-auth\signup-live-verification.log`
스크린샷: 같은 폴더 `signup-01..07-*.png`

### 11.1 이메일 열거 방지 실측

| 표면                         | 존재하는 주소                                                 | 없는 주소               | 판정                    |
| ---------------------------- | ------------------------------------------------------------- | ----------------------- | ----------------------- |
| `POST /auth/signup`          | 200 `{"accepted":true}`                                       | 200 `{"accepted":true}` | 동일                    |
| `POST /auth/password/forgot` | 200 `{"accepted":true}`                                       | 200 `{"accepted":true}` | 동일 (sha256 일치 확인) |
| `POST /auth/invite/accept`   | 만료·재사용·위조 토큰 전부 400 `invalid_token`, 본문 86바이트 | 좌동                    | 동일                    |

**타이밍은 같지 않다.** 첫 요청에서 존재하는 주소가 더 오래 걸린다(가입 247ms 대 110ms, 비밀번호 찾기 39ms 대 11ms). 원인은 IX-Auth 가 존재하는 주소에만 메일을 한 통 보내기 때문이고(SMTP 왕복), 게이트웨이가 만드는 차이도 없앨 수 있는 차이도 아니다. 완화는 두 가지다. 같은 주소 재요청은 발송 쿨다운에 걸려 15ms 대로 수렴하고(3회 실측), 게이트웨이 IP 리미터가 로그인과 같은 버킷에서 4회째부터 429 로 막는다. 근본 해결은 IX-Auth 가 메일 발송을 요청 처리 밖으로 빼는 것이고, 그것은 벤더 트리 구역 B 변경이라 이 단계 범위 밖으로 남긴다.

### 11.2 실측으로 잡은 결함·제약 4건

| #   | 증상                                                      | 원인·처리                                                                                                                    |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | SMTP 배포에서 초대 한 건마다 3초가 걸렸다                 | 웹훅을 기다리는 창이 3초 고정이었다. SMTP 에서는 웹훅이 영영 오지 않는다. 창을 800ms 로 줄이고, 화면은 목록을 다시 읽어 판정 |
| 2   | 메일이 나갔는데도 화면이 링크를 기다렸다                  | 응답만 보고 "발송함" 을 정했다. 지금은 목록을 다시 읽은 뒤에 정한다                                                          |
| 3   | 토큰 화면에서 주소가 `/chat` 으로 바뀐다                  | 앱 라우터가 주소를 정규화한다. 토큰은 이미 메모리에 있어 흐름은 정상이지만, **새로고침하면 메일 링크를 다시 열어야 한다**    |
| 4   | 이미 로그인한 브라우저로 초대 링크를 열면 앱으로 들어간다 | 로그인 전 게이트는 연결이 없을 때만 뜬다. 초대받은 사람은 다른 브라우저를 쓰는 것이 정상 경로라 그대로 둔다                  |

### 11.3 운영상 알아 둘 것

- **자기 가입 계정에는 IX-Auth 역할이 붙지 않는다.** 원본 기본 역할 `USER` 는 `roleMap` 에 없어서 `gateway.roles.default`(`member`)로 떨어진다. 역할을 명시하려면 승인 뒤 콘솔에서 부여한다. 초대는 발급 화면에서 역할을 고르므로 해당 없음.
- **보관 중인 초대 링크는 게이트웨이 재시작에 사라진다.** 메모리 저장이라 그렇다. 링크가 필요하면 재발급한다(8.2).
- 로그인 전 화면에서 `GET /control-ui-config.json` 이 401 을 낸다. 이 모드에서 원래 그렇고 이 단계와 무관하다.

## 12. 가정 (사용자 미확정)

| #   | 가정                                                              | 근거                                                                                                                                     |
| --- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SMTP 는 선택. 있으면 `APPROVAL` + `EMAIL`, 없으면 초대장 전용     | 감독자 지시                                                                                                                              |
| 2   | 초대 링크 만료 72시간 (IX-Auth 기본값 7일에서 축소)               | 감독자 지시                                                                                                                              |
| 3   | 초대는 곧 승인. 수락 즉시 활성                                    | 감독자 지시                                                                                                                              |
| 4   | 도메인 제한은 설정으로, 초대에는 미적용                           | 감독자 지시 + IX-Auth 구현                                                                                                               |
| 5   | 비밀번호 정책은 IX-Auth 기본값                                    | 감독자 지시                                                                                                                              |
| 6   | 설정 키 `selfSignup` 1개 추가, `.env` 한 변수에서 유도            | 3.2                                                                                                                                      |
| 7   | SMTP 없는 배포의 기본 메일 전송은 `WEBHOOK` (원본 기본값은 `LOG`) | 6.1. LOG 는 관리자가 컨테이너 로그를 봐야 한다                                                                                           |
| 8   | 약관 동의 화면은 만들지 않았다                                    | IX-Auth 에 게시된 약관이 없으면 `GET /auth/terms` 가 빈 목록이라 가입에 동의 단계가 필요 없다. 고객이 약관을 게시하면 그때 화면을 붙인다 |

## 13. 보류

| 항목                           | 사유                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| 고객 SMTP 자격증명·발신 도메인 | 사용자 결정 사항. `.env` 항목만 준비했다                       |
| 약관 문안·필수 여부            | 법무 검토 대상. IX-Auth 콘솔에서 게시하면 가입 화면이 따라간다 |
| TOTP 등록 화면                 | A 단계부터의 미구현 항목. IX-Auth 콘솔에서 등록한다            |
