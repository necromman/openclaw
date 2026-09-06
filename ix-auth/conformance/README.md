# 적합성 검사

계약(`docs/contract/`)대로 동작하는지 **HTTP 로만** 확인한다.

```bash
python conformance/run.py \
  --base-url    http://localhost:9100 \
  --service-key "$IXAUTH_SERVICE_KEY" \
  --admin-email admin@example.com \
  --admin-password '...'
```

실패가 있으면 종료 코드 1. 의존성은 없다 — 파이썬 표준 라이브러리만 쓴다.

## 왜 SDK 를 쓰지 않는가

SDK 가 계약을 잘못 읽고 있어도 그 오해가 검사에 섞이면 안 되기 때문이다. 실제로 이 검사기는 그런 불일치에서 출발했다 — `batch-check` 응답의 `data` 는 **배열**인데 계약 문서에는 요청 형식만 적혀 있었고, SDK 는 객체로 읽고 있었다. 계약에 없으면 구현마다 다르게 추측한다.

같은 이유로, 새 언어의 SDK 를 만들 때 **이 검사기가 통과하는 응답 형태**를 기준으로 삼으면 된다.

## 검사 항목

| ID | 확인하는 것 |
|----|------------|
| `PUB-1` | JWKS 는 인증 없이 열리고, **개인키 성분이 섞여 있지 않다** |
| `SVC-1·2` | 서비스 키 누락/불일치를 계약 에러코드로 구분해 알린다 |
| `ENV-1·2·3` | 응답 봉투(`data` / `error.code` + `traceId`), 스택트레이스·SQL 미노출 |
| `LOGIN-1` | **없는 계정과 틀린 비밀번호를 구분하지 않는다** (코드·메시지 모두) |
| `LOGIN-2` | 응답에 비밀번호·해시가 없다 |
| `TOK-1·2` | RS256 + `kid`, `ixauth_roles`·`ixauth_pv` 클레임 |
| `TOK-3` | **refresh 가 JWT 가 아니다** — JWT 면 폐기할 수 없어 로그아웃이 무력해진다 |
| `TOK-4` | 위조 서명 거부 |
| `MAP-1·2` | permission-map 의 `version` 이 토큰 `ixauth_pv` 와 일치 |
| `CODE-1·2` | 권한 코드 문법 위반 거부 (`**` 중간 배치, 3파트 아님) |
| `L2-1` | 판정 근거(`reason`)를 항상 반환 |
| `L2-2` | `batch-check` 의 `data` 는 배열이고 **요청 순서를 지킨다** |
| `L2-3` | 100건 초과 거부 — 상한이 없으면 한 요청으로 jar 를 세울 수 있다 |
| `L2-4` | `list-resources` 는 `keys` + `truncated` |
| `SES-1` | refresh 회전 |
| `SES-2` | **재사용 감지** — 이미 쓴 refresh 는 통하지 않는다 |
| `SES-3` | 로그아웃하면 그 refresh 가 실제로 죽는다 |
| `SES-4·5` | 실패 누적 잠금 423, 단 **틀린 비밀번호에는 잠김을 알리지 않는다** |
| `IMP-1·4` | 대리 응답이 로그인 봉투이고 **대상 사용자**의 토큰이다 |
| `IMP-2·3` | 대리 토큰에만 표준 `act` 클레임이 실린다 (평범한 로그인에는 없다) |
| `IMP-5` | 대리 세션으로 **관리 API·재대리·비밀번호 변경이 막힌다** |
| `IMP-6` | refresh 회전에도 `act` 가 살아남는다 |
| `IMP-7` | 자기 자신 대리 거부 |
| `IMP-8` | 대리 세션이 세션 목록에 보이고 `IMPERSONATION_STARTED` 가 남는다 |
| `FED-1` | 연합이 꺼진 인스턴스는 `AUTH_FEDERATION_DISABLED` 403 (기본값) |
| `FED-2` | 허용 목록 밖 provider 는 `AUTH_FEDERATION_PROVIDER_NOT_ALLOWED` 403 |
| `FED-3` | 연합 토큰이 로그인 봉투이고 `ixauth_idp` 가 **회전에도** 남는다 |
| `FED-4` | **서비스 키 없이는 401** — 이 경로의 신뢰 근거는 그 키 하나뿐이다 |
| `FED-5` | 자체 인증 토큰에는 `ixauth_idp` 가 없다 |

## 세션 검사는 전용 계정으로 돈다

`SES-*` 는 세션을 폐기시키고 계정을 잠근다. `IMP-*` 도 전용 계정 하나를 더 만든다 — 실제 사용자를 대리하면 그 사람 이름으로 감사 로그가 쌓인다. 관리자 계정으로 돌리면 **지금 그 계정으로 로그인해 있는 사람이 튕긴다.** 그래서 검사기가 `conformance-<랜덤>@ix-auth.invalid` 계정을 만들어 쓰고, 끝나면 비활성화한다(계약상 소프트 삭제 — 물리 삭제는 감사 로그의 참조를 끊는다).

계정을 만들지 못하면 `SES-*` 는 FAIL 이 아니라 **SKIP** 된다. 남겨서 들여다보려면 `--keep-test-user`.

## 연합 검사는 설정을 바꾸지 않는다

`FED-*` 는 인스턴스의 `federation.*` 을 **읽기만** 한다. 검사를 위해 잠깐 켜면 그 순간부터 서비스 키를 쥔 쪽이 아무 신원이나 주장할 수 있게 되고, 검사기가 중간에 죽으면 켜진 채로 남는다. 기본(꺼짐) 인스턴스에서는 `FED-1`·`FED-4`·`FED-5` 만 돌고 나머지는 SKIP 이다.

## 운영 인스턴스에 돌려도 되나

`SES-*` 가 계정 하나를 만들고 잠그고 비활성화하며, 감사 로그에 그 흔적이 남는다. 나머지는 읽기와 실패 요청뿐이다. 스테이징에서 돌리는 것을 기본으로 하고, 운영에 돌려야 한다면 그 흔적이 남는다는 것을 알고 한다.

## 데모 스택에 돌려보기

```bash
examples/react-demo/run-demo.sh          # jar·BFF·화면을 띄운 뒤
python conformance/run.py --base-url http://localhost:9100 \
  --service-key "demo-service-key-at-least-32-characters" \
  --admin-email admin@demo.local --admin-password 'Dem0!Passw0rd'
```
