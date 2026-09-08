# 사람 귀속 감사 원장 정본

> "누가 무엇을 물었고 어떤 자료를 봤는지 기록이 남습니다"(제안서 4장)를 코드로 옮긴 것이다. 로그인·세션은
> [AUTH-IXAUTH.md](AUTH-IXAUTH.md), 사용자 관리는 [AUTH-USERS.md](AUTH-USERS.md), 부서 경계는
> [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md), 설치는 [DEPLOY.md](DEPLOY.md).
>
> 작성 2026-09-08 (KST). 구현 범위 = H 단계.

---

## 1. 한 문단 요약

게이트웨이는 사람 단위 활동을 **`audit_user_activity`** 한 표에 동기로 적는다. 로그인·로그아웃·거절된 로그인, 사용자가 던진 질문, 파일 경로가 드러나는 도구 호출, 타인 세션 열람, 파일 미리보기·내려받기, 관리자 행위, 부서 경계 거부 - 아홉 가지다. 기존 `audit_events` 는 **손대지 않았다**. 그쪽은 "어느 에이전트가 어떤 도구를 돌렸나" 를 답하는 메타데이터 전용 원장이고 actor 가 사람이 아니라서, 넓히면 그 계약을 읽는 다른 코드가 깨진다. 조회는 세 가지다. RPC `audit.userActivity.list`(CLI·화면), CSV `GET /auth/admin/audit/export.csv`, 화면 **설정 > 감사 기록**(`/settings/audit`). 인가는 한 곳(`src/gateway/user-activity-audit-query.ts`)에서만 판정한다.

## 2. 표

`src/state/user-activity-audit-schema.ts`. 부서 표(B 단계)·로그인 세션 표와 같은 자리, 같은 방식이다. **기능 지역(feature-local) 추가 표**라서 정본 `openclaw-state-schema.sql` 에도, 스키마 버전에도 들어가지 않는다. 첫 기록 시점에 게으르게 생성되고(`ensureUserActivityAuditSchema`), 한 번도 기록하지 않은 배포에는 아예 없다. **조회는 표를 만들지 않는다** - 없으면 빈 페이지가 정직한 답이다.

| 컬럼                       | 내용                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| `sequence`                 | AUTOINCREMENT. 커서 페이지네이션의 기준                                       |
| `at`                       | epoch ms                                                                      |
| `kind`                     | 3절의 아홉 가지                                                               |
| `actor_source`             | `profile`(계정) / `channel`(텔레그램 발신자) / `operator`(호스트 셸·CLI)      |
| `profile_id`               | `user_profiles.id`. 채널·호스트는 비어 있다                                   |
| `email`                    | 계정 주소. `actor_source=channel` 이면 **채널 스코프 발신자 id**              |
| `display_name`             | 표시 이름                                                                     |
| `gateway_role`             | `roleMap` 을 거친 게이트웨이 역할. 기록 시점 값이다                           |
| `departments`              | JSON 배열. 기록 시점 값이다                                                   |
| `session_key` · `agent_id` | 해당하는 경우                                                                 |
| `detail`                   | JSON 객체. 종류마다 모양이 다르다. **4KiB 상한**, 넘으면 통째로 표식으로 교체 |
| `remote_ip` · `user_agent` | HTTP 경로에서만 채워진다                                                      |
| `request_id`               | `x-request-id` 가 있으면                                                      |

문자열 컬럼은 512자에서 자른다. 원장 한 줄은 증거이지 페이로드 사본이 아니다.

색인은 `(at DESC, sequence DESC)`, `(profile_id, ...)`, `(kind, ...)`, `(session_key, ...)` 넷.

## 3. 종류와 기록 지점

| kind            | 언제                                            | 기록 지점(파일:함수)                                                               | detail                                 |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| `login`         | 로그인 완료 직후                                | `src/gateway/ix-auth-http.ts` `completeIxAuthLogin`                                | `identitySessionId`                    |
| `logout`        | 세션 폐기 직후                                  | `src/gateway/ix-auth-http.ts` `handleIxAuthLogoutRoute`                            | -                                      |
| `login_failed`  | 신원 서버가 거절                                | `handleIxAuthLoginRoute` · `handleIxAuthMfaRoute`                                  | `reason`(신원 서버 코드)               |
| `prompt`        | 질문이 세션에 들어감                            | `src/gateway/server-methods/chat-send-handler.ts` `handleChatSendWithOptions`      | `chars` `digest`(+ `text` `truncated`) |
| `tool_read`     | 파일을 드러내는 도구 호출이 **완료**            | `src/audit/user-activity-tool-reads.ts` (도구 실행 이벤트 구독)                    | `toolName` `paths`                     |
| `session_view`  | 타인 세션 전사 열람                             | `chat-history-handler.ts` · `sessions-history-http.ts`                             | `surface`                              |
| `file_download` | 세션 파일 열람·미리보기                         | `src/gateway/server-methods/sessions-files.ts` `sessions.files.get`                | `path` `preview`                       |
| `admin_action`  | 초대·역할·부서·상태·삭제·세션 종료·CSV 가져오기 | `src/gateway/ix-auth-admin-ledger.ts` `recordIxAuthAdminAction`                    | `action` `targetUserId` + 행위별 값    |
| `access_denied` | 부서 경계가 막음                                | `operator-role-policy.ts` · `chat-history-handler.ts` · `sessions-history-http.ts` | `reason` `surface`                     |

기록 지점 넷은 F 단계가 남긴 훅(`recordIxAuthAdminAction`) 하나와, 사람 신원이 살아 있는 경계 셋이다.

`sessions.send`·`sessions.steer` 는 별도 경로처럼 보이지만 같은 `chat.send` 핸들러로 들어간다(`sessions-messaging.ts:188`). 텔레그램 같은 채널 수신도 같은 핸들러를 지나며, 그때 클라이언트에 실린 발신자 정보로 `actor_source=channel` 행이 된다.

### 3.1 사람은 어디서 오나

- **HTTP**: 검증된 principal 이 그 자리에 있다.
- **WebSocket**: 핸드셰이크가 `internal.ixAuthAuditActor` 를 붙인다(`src/gateway/ix-auth-audit-actor.ts`). 부서 판정이 쓰는 `ixAuthDepartments` 와 **별도 주머니**다. 이름·역할 라벨은 권한이 아니므로 인가 코드가 이것을 읽지 않는다는 사실이 눈에 보여야 한다.
- **도구 호출**: 실행 시점에는 그 연결이 없다. 질문이 들어온 순간(위 `prompt`)에 `sessionKey → 사람` 을 프로세스 메모리에 512개까지 기억해 두고, 같은 턴의 도구 이벤트가 그것을 읽는다(`src/audit/user-activity-session-actors.ts`). **세션 키로 사람을 역산하지 않는다** - 감사 서브시스템이 금지하는 일이고, 재시작 후에는 기억이 없으므로 그 턴은 기록되지 않는다.
- **채널(텔레그램)**: 계정이 없다. `actor_source=channel` 과 발신자 id 로 남는다. 발신자와 IX-Auth 계정을 잇는 장치는 이 포크에 없다(AUTH-DEPARTMENTS 14.3).

### 3.2 도구 인자에서 경로만 꺼내는 방법

`src/audit/tool-read-paths.ts` 가 **닫힌 목록 두 개**를 갖는다. 파일을 드러내는 것이 목적인 도구 이름(`read`·`memory_get`·`sessions_files` 등)과, 파일을 가리키는 인자 이름(`path`·`file_path`·`paths` 등). 그 교집합만 읽어서 문자열 배열을 만들고, 그 배열만 진단 이벤트에 실린다(`readPaths`). 인자 객체 전체는 어디에도 전달되지 않으므로, 어떤 도구가 다른 필드에 비밀을 담고 있어도 원장으로 새지 않는다. 경로 8개·각 512자 상한.

새 도구는 **기본 제외**다. 누군가 그 목록에 넣기로 결정해야 들어간다.

## 4. 개인정보

| 항목                          | 기본값            | 근거                                                                                                   |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| 질문 본문                     | **저장 안 함**    | 길이(`chars`)와 sha256 앞 32자(`digest`)만. 같은 질문의 상관은 되고, 원장을 읽는 사람이 내용은 못 본다 |
| 도구 인자                     | **저장 안 함**    | 3.2 의 경로만                                                                                          |
| 로그인 실패 시 계정 존재 여부 | **기록 안 함**    | "없는 계정" 과 "틀린 비밀번호" 를 구분하면 원장 자체가 계정 열거 도구가 된다                           |
| 비밀번호·토큰·쿠키            | **어디에도 없음** | principal 은 연결에 실리지 않는다                                                                      |

질문 본문을 켜려면 `logging.audit.userActivity.promptText: true`. 켜는 순간 사용자가 쓴 글이 원장에 들어가므로 배포 결정 사항이다.

## 5. 설정과 보존

```jsonc
{
  "logging": {
    "audit": {
      "enabled": true, // 이 스위치가 꺼지면 사람 원장도 함께 꺼진다
      "userActivity": {
        "promptText": false, // 기본값. 질문 본문 저장
        "retentionDays": 90, // 기본값
        "maxRows": 1000000, // 기본값
      },
    },
  },
}
```

별도의 on/off 키를 만들지 않았다. 감사 수집을 멈추는 방법이 두 개면 운영자가 어느 쪽이 실제로 멈추는지 알 수 없다.

정리는 **기존 감사 라이터의 정비 스윕**(1시간 주기, 기동 직후 1회)에 얹혀 돈다(`src/audit/audit-event-writer.ts` `reportMaintenance`). 한 번에 1,024행씩 지우고, 지울 것이 남으면 다음 패스를 스스로 예약한다. 보존기간 초과분을 먼저 지우고, 그래도 `maxRows` 를 넘으면 오래된 것부터 지운다. **수집이 꺼져 있어도 정리는 돈다** - 끄는 것과 남기는 것은 다른 결정이다.

쓰기는 **동기**다. 메타데이터 원장은 큐가 넘치면 버릴 수 있다(잃는 것이 진단 한 줄이므로). 여기서 잃는 것은 "누가 봤나" 의 답이라 버리지 않는다. 실패하면 진단 로그 한 줄을 남기고 요청은 그대로 진행한다 - 원장이 로그인을 깨뜨리는 쪽이 더 나쁘다.

## 6. 조회 세 가지

### 6.1 RPC

`audit.userActivity.list`. 필터 `profileId` `email` `kind` `agentId` `sessionKey` `from` `to`, 페이지 `limit`(최대 500) `cursor`.

| 호출자                    | 보이는 것                      |
| ------------------------- | ------------------------------ |
| 호스트 셸·CLI(계정 없음)  | 전부. 이미 DB 파일을 갖고 있다 |
| 시스템 관리자(superadmin) | 전부                           |
| 관리자(admin), 부서 있음  | **자기 부서 사람의 행만**      |
| 관리자(admin), 부서 없음  | **자기 행만**                  |
| 임원·중재자·직원          | 403                            |

부서 없는 관리자를 전체가 아니라 자기 행으로 좁힌 것은 의도다. 부서가 비어 있는 관리자는 미완성 설정이고, 미완성 설정의 안전한 해석은 좁은 쪽이다.

### 6.2 CSV

`GET /auth/admin/audit/export.csv?email=&kind=&from=&to=`. 세션 쿠키 + 관리자 판정(`resolveIxAuthAdminContext`) + 6.1 과 **같은 부서 좁히기**. 최대 10,000행. `Content-Disposition: attachment` 와 `nosniff` 로 내려받기 전용이다 - 원장에는 사용자가 쓴 글이 있어서 브라우저가 화면에 그리면 안 된다. 셀 값이 `=`·`+`·`-`·`@` 로 시작하면 앞에 `'` 를 붙인다(스프레드시트 수식 주입 방지).

### 6.3 CLI

```bash
openclaw audit users --email kim@example.com --kind tool_read --since 2026-09-01 --limit 50
openclaw audit users --json
```

호스트 셸은 경계 밖이므로 전부 보인다.

**읽는 곳이 둘이다.** 먼저 RPC 를 부르고, RPC 가 *답하지 못했을 때만* 이 호스트의 상태 SQLite 를 직접 읽는다
(`src/commands/audit-users-source.ts`).

|        | RPC 경로                                        | 로컬 직접 읽기                                                                        |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| 언제   | 기본. 게이트웨이가 살아 있고 인증이 되면 항상   | 전송 실패(연결 끊김·거절·타임아웃)·자격증명 없음 **그리고** 대상이 로컬 게이트웨이일 때 |
| 인가   | 6.1 표 그대로. 계정이 실린 연결이면 부서로 좁힌다 | `queryUserActivityAudit` 의 **같은 `host` 리더**. 좁히지 않는다                        |
| 알림   | 없음                                            | 첫 줄에 `Local read: ...` 한 줄. `--json` 이면 그 줄은 **stderr**, 페이지는 stdout      |

폴백 조건이 저 둘 다인 이유:

- **답한 거절은 폴백하지 않는다.** 핸들러가 `FORBIDDEN`·`INVALID_REQUEST` 로 답했다면 그것은 결정이다. 그 결정을
  우회해 로컬을 읽으면 인가 판정이 인가 우회가 된다. 핸들러가 돌기 *전에* 끝난 실패(소켓 종료·타임아웃·자격증명
  부재)만 질문을 미해결로 남기고, 그것만 로컬에 다시 묻는다.
- **원격 대상은 폴백하지 않는다.** `gateway.mode=remote` 나 `--url` 은 다른 호스트를 가리키고 그 호스트의 원장은
  이 파일시스템이 아니다. 거기서 로컬을 읽으면 폴백이 아니라 **틀린 답**이다. `isImplicitLocalGatewayTarget` 로
  가른다.

로컬 직접 읽기에 부서 필터를 걸지 않은 것도 의도다. RPC 가 관리자를 자기 부서로 좁히는 근거는 연결에 신원
서버가 보증한 계정이 실려 있다는 사실이다. 로컬 읽기에는 그 계정이 없고, 그것을 실행할 수 있는 사람은 이미 DB
파일을 열고 복사하고 고칠 수 있다. 그 위에 행 필터를 얹는 것은 통제가 아니라 시늉이다. 그래서 좁히는 대신
**넓다는 사실을 매 출력의 첫 줄로 밝힌다**. `--json` 은 두 경로가 **같은 모양**을 낸다(`events`·`nextCursor`).
알림만 stderr 로 빠진다 - 소비자가 어느 경로였는지 알아야 파싱할 수 있으면 그것은 계약이 둘인 것이다.

이 폴백이 없으면 납품 스택(ix-auth)에서 이 명령은 아예 못 쓴다. ix-auth 모드에는 공유 시크릿이 없어서 컨테이너
안의 CLI 가 자기 게이트웨이 RPC 에 인증할 수 없고(`client=cli ... reason=gateway_auth_required`), 호스트 셸은
고객에게 열어 주지 않는 것이 이 납품의 전제다.

### 6.4 화면

**설정 > 개인정보 보호 & 보안 > 감사 기록**(`/settings/audit`). superadmin·admin 에게만 보인다. 필터 바(사람·종류·기간), 표(시각·사람·역할·부서·종류·요약·세션), 행을 누르면 `detail` 원본, CSV 버튼. 라우트는 지연 로드라 시작 번들에 바이트를 더하지 않는다.

## 7. 한계

| 한계                                              | 내용                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **변조 방지가 없다**                              | 해시 체인을 넣지 않았다. DB 파일을 쓸 수 있는 사람은 행을 고칠 수 있다. 장기 보존·부인 방지는 외부 SIEM 이 정본이다 |
| **전사를 넘길 때마다 한 줄이 남는다**             | `chat.history` 는 페이지 단위 호출이라 긴 전사를 훑으면 `session_view` 가 여러 줄 생긴다. 시각으로 묶어 읽는다      |
| **재시작하면 진행 중 턴의 `tool_read` 가 끊긴다** | `sessionKey → 사람` 기억이 프로세스 메모리라서 그렇다. 재시작 후 첫 질문부터 다시 이어진다                          |
| **cron·시스템이 시작한 실행은 기록되지 않는다**   | 사람이 없기 때문이다. 없는 사람을 지어내는 것보다 공백이 낫다                                                       |
| **부서 필터는 기록 시점 부서로 판정한다**         | 사람이 부서를 옮기면 과거 행은 옛 부서에 남는다. 그때 그 사람이 그 부서였다는 것이 사실이므로 의도한 동작이다       |
| **채널 발신자는 계정과 이어지지 않는다**          | AUTH-DEPARTMENTS 14.3                                                                                               |
| **에이전트가 셸로 읽은 파일은 안 잡힌다**         | 3.2 의 도구 목록 밖이다. 부서 에이전트는 셸을 끄는 것이 전제다(AUTH-DEPARTMENTS 13.4)                               |
| **CLI 로컬 폴백은 부서로 좁히지 않는다** | 6.3. 컨테이너·호스트 셸에 들어올 수 있는 사람은 운영자라는 전제 위에 선다. 좁히는 대신 출력 첫 줄로 밝힌다 |

## 8. 계약 문구 초안

> 내장 감사 원장은 설정된 보존기간(기본 90일) 안에서 "누가 언제 무엇을 물었고 어떤 파일이 열렸는지" 를 조회하기 위한 것이다. 변조 방지 기능은 포함하지 않으며, 장기 보존과 부인 방지가 필요한 경우 고객사 SIEM 으로의 내보내기를 정본으로 한다. 질문 본문은 기본적으로 저장하지 않고 길이와 해시만 남기며, 저장 여부는 배포 설정으로 결정한다.

## 9. 파일 지도

### 9.1 신규

| 경로                                                          | 역할                           |
| ------------------------------------------------------------- | ------------------------------ |
| `src/state/user-activity-audit-schema.ts`                     | DDL·종류 목록·게으른 생성      |
| `src/state/user-activity-audit-store.ts`                      | append·list·prune (Kysely)     |
| `src/audit/user-activity-audit-recorder.ts`                   | 정책 판정 + 실패 삼킴          |
| `src/audit/user-activity-prompt-detail.ts`                    | 질문 → detail 투영             |
| `src/audit/user-activity-session-actors.ts`                   | 세션 → 사람 기억(한정, 메모리) |
| `src/audit/user-activity-tool-reads.ts`                       | 도구 실행 이벤트 → `tool_read` |
| `src/audit/tool-read-paths.ts`                                | 경로 추출 허용목록             |
| `src/audit/user-activity-audit-retention.ts`                  | 기존 정비 스윕에 얹는 정리     |
| `src/gateway/ix-auth-audit-actor.ts` (+ `-type`)              | 연결에 붙는 귀속 사실          |
| `src/gateway/ix-auth-activity-audit.ts`                       | 로그인·로그아웃·실패 기록      |
| `src/gateway/chat-send-activity-audit.ts`                     | 질문 기록 + 세션 귀속          |
| `src/gateway/session-view-activity-audit.ts`                  | 열람·내려받기·거부 기록        |
| `src/gateway/user-activity-audit-query.ts`                    | **인가 한 곳** + 조회          |
| `src/gateway/user-activity-audit-csv.ts`                      | CSV 투영                       |
| `src/gateway/ix-auth-admin-audit-http.ts`                     | CSV 내보내기 라우트            |
| `src/gateway/server-methods/audit-user-activity.ts`           | RPC 핸들러                     |
| `src/commands/audit-users.ts`                                 | `openclaw audit users`         |
| `src/commands/audit-users-source.ts`                          | RPC 우선 + 로컬 폴백 판정      |
| `src/gateway/user-activity-audit-wire.ts`                     | 원장 행 -> 프로토콜 이벤트     |
| `packages/gateway-protocol/src/schema/audit-user-activity.ts` | 프로토콜 계약                  |
| `ui/src/pages/audit/*`, `ui/src/styles/audit.css`             | 화면                           |

### 9.2 수정 (훅 지점만)

| 경로                                                                                                 | 무엇                                |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `src/config/types.base.ts` · `zod-schema.root-shape.ts` · `schema.help.core.ts` · `schema.labels.ts` | 설정 키 3개                         |
| `src/audit/audit-config.ts`                                                                          | `resolveUserActivityAuditPolicy`    |
| `src/audit/audit-event-writer.ts`                                                                    | 정비 목록에 한 줄                   |
| `src/infra/diagnostic-events.ts`                                                                     | 도구 이벤트에 `readPaths` 선택 필드 |
| `src/agents/agent-tools.before-tool-call.wrapper.ts`                                                 | `buildEventBase` 에 경로 투영 한 줄 |
| `src/gateway/auth.ts` · `http-auth-utils.ts`                                                         | 귀속 사실을 요청 인증 결과에 실음   |
| `src/gateway/server/ws-connection/connect-session.ts`                                                | 핸드셰이크 사실 한 줄               |
| `src/gateway/server-methods/client-types.ts`                                                         | `internal.ixAuthAuditActor`         |
| `src/gateway/ix-auth-http.ts` · `ix-auth-http-paths.ts` · `ix-auth-admin-http.ts`                    | 기록 3곳 + 내보내기 라우트          |
| `src/gateway/ix-auth-admin-ledger.ts`                                                                | F 단계 훅에 원장 쓰기               |
| `src/gateway/methods/core-descriptors.ts` · `server-methods/core-handlers.ts`                        | RPC 등록                            |
| `ui/src/app-route-paths.ts` · `app-routes.ts` · `app-navigation.ts` · `i18n/locales/en*.ts`          | 라우트·항목·문구                    |
