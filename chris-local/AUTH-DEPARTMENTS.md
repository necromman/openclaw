# 부서 접근 강제 정본

> 이 문서가 `gateway.auth.mode: "ix-auth"` + `tools.sessions.visibility: "department"` 의 정본이다.\
> 모드 전체 구조는 [AUTH-IXAUTH.md](AUTH-IXAUTH.md), 배포 절차는 [DEPLOY.md](DEPLOY.md),
> 채택 근거의 역사는 [AUTH-PLAN.md](AUTH-PLAN.md) 1.1 (D) 와 2.4 에 있다.
>
> 작성 2026-09-07 (KST, 일요일). 구현 범위 = B 단계.

---

## 1. 한 문단 요약

IX-Auth 가 "누가 어느 부서인가" 를 갖고, 포크가 "그 부서가 무엇을 볼 수 있는가" 를 강제한다. 부서 코드는 매 요청의 **검증된 토큰**에서 읽는다. 포크 DB 에도 같은 값을 투영해 두지만 그것은 운영자가 보기 위한 사본이고, **인가 판정에는 절대 쓰지 않는다.** 사본이 낡아도 아무의 권한도 넓어지지 않는다는 뜻이다.

경계는 **에이전트**에 그어진다. 세션은 어느 에이전트의 저장소·워크스페이스·스킬·지식 안에서만 살기 때문에, 에이전트가 이미 데이터 경계다.

## 2. 규칙 (세 줄)

| 호출자                  | 볼 수 있는 것                                                                |
| ----------------------- | ---------------------------------------------------------------------------- |
| `superadmin`            | 전부. 부서 게이트가 아예 만들어지지 않는다                                   |
| 부서가 1개 이상인 사람  | 자기 부서에 묶인 에이전트 + **부서에 묶이지 않은 에이전트**. 그 밖은 없는 것 |
| 부서가 하나도 없는 사람 | 부서에 묶이지 않은 에이전트에서 **자기가 만든 세션만**                       |

에이전트 하나는 부서 하나에 묶인다(또는 어디에도 안 묶인다). 두 부서가 함께 쓰는 에이전트는
**묶지 않는 것**으로 표현한다.

**미바인딩 에이전트를 파티션 밖에 두는 이유.** 처음에는 "부서 없는 에이전트의 세션은 생성자
전용" 으로 잡았다가 라이브에서 되돌렸다. 공용 홈 세션 `agent:main:main` 이 최초 생성자 말고는
전부 "was not found" 로 떨어져 **기본 진입 화면이 죽었다**. 펜스는 에이전트 단위 opt-in 이고,
안 묶은 에이전트는 운영자가 일부러 공용으로 둔 것이다. 미배정자만 좁히면 두 요구가 다 산다.

## 3. 역할과 부서는 직교한다

역할은 "무엇을 할 수 있는가", 부서는 "어느 데이터에 닿는가" 다. 둘은 곱해진다.

| 역할         | 세션 타인 열람 (역할 상한) | 부서 경계                                    |
| ------------ | -------------------------- | -------------------------------------------- |
| `superadmin` | write                      | **없음** (전 부서)                           |
| `admin`      | write                      | 자기 부서                                    |
| `executive`  | view                       | 자기 부서들. 전 부서 열람은 전 그룹 소속으로 |
| `moderator`  | suggest                    | 자기 부서                                    |
| `member`     | view                       | 자기 부서                                    |

**`executive` 는 경계에 뚫은 구멍이 아니다.** 임원도 다른 사람과 똑같이 "자기 부서" 만 본다.
다만 초대 시점에 모든 `dept-` 그룹에 넣기 때문에 자기 부서가 곧 전 부서가 된다. 경계 코드
(`src/gateway/department-access.ts`)에는 임원을 위한 분기가 하나도 없고, 그룹에서 빼면 그 즉시
좁아진다. "전 부서 읽기 전용" 상태를 경계에 새로 넣었다면 캐시 키·목록 필터·에이전트 선택까지
전부 다시 설계해야 했고, 그 어느 한 곳이라도 새면 부서 간 유출이 된다.

임원의 상한은 `view` 다. 남의 부서 세션이 열려도 **읽기만** 되고 쓰기는 안 된다. 부서는 상한을
넓히지 않고 좁히기만 한다는 원칙이 임원에게도 그대로 적용된다.

**`admin` 은 부서를 넘지 못한다.** `operator.admin` 스코프의 전역 통과(`isGatewayAdmin`)보다
부서 검사가 **앞에** 있고, 그 관문은 `superadmin` 만 통과한다. 배포 설정에서 `operator.admin`
을 가진 것은 `superadmin` 뿐이지만, 판정은 스코프가 아니라 토큰의 `isSuperAdmin` 으로 한다 -
스코프가 늘어나도 경계가 새지 않게.

역할 상한은 그대로 남는다. 같은 부서 동료의 세션이라도 `member`(view)·`moderator`(suggest) 는
읽기만 되고 쓰기는 안 된다. 부서는 상한을 **넓히지 않고**, 좁히기만 한다.

## 4. 켜고 끄기

새 설정 키를 만들지 않았다. 기존 키 하나에 값이 늘었다.

```json5
{
  gateway: { auth: { mode: "ix-auth" /* ... */ } },
  tools: { sessions: { visibility: "department" } },
}
```

**두 조건이 모두 참일 때만** 강제된다. `tools.sessions.visibility` 가 `self`·`tree`·`agent`·`all`
이면 부서 코드는 principal 까지만 오고 아무것도 막지 않는다(= A 단계 동작). `gateway.auth.mode`
가 `token`·`trusted-proxy` 면 검증된 부서 자체가 없으므로 게이트가 만들어지지 않는다.

`department` 를 고른 이유: 이 값은 "내 세션만"(`self`)과 "전부"(`all`) 사이의 범위이고, 부서
경계는 IX-Auth 신원이 있을 때만 의미가 있다. 새 키를 만들면 설정 표면만 늘고 두 값이 서로
어긋날 수 있다.

**모델의 `sessions` 도구 축에서의 의미**: `department` 는 에이전트 경계(`agent`)와 같게 판정한다. 에이전트 실행에는 사람 principal 이 없어 부서를 물어볼 대상이 없기 때문이고, 부서가 에이전트를 분할하므로 이 판정은 절대 부서를 넘지 않는다(보수적). 같은 부서의 다른 에이전트끼리 열람을 허용하는 것은 후속 과제다.

## 5. 부서 코드 체계 - 감독자 결정

**`dept-` 접두사를 쓴다.** `dept-rnd`, `dept-qa`. slug 는 소문자·하이픈.

원래 지시는 `dept:<slug>` 였으나 감독자가 `dept-` 로 확정했다. 근거:

- A 단계에서 이미 출시된 기본값이 `departmentGroupPrefix: "dept-"` 이고 라이브 검증까지 끝났다.
  바꾸면 이미 만든 그룹과 문서가 어긋난다.
- IX-Auth 의 그룹 코드 제약을 소스로 확인했다. `ix-auth/ix-auth-server/.../domain/Group.java` 는 `@Column(nullable=false, unique=true, length=50)`, `api/admin/AccessAdminController.java` 의 `CodeRequest` 는 `@NotBlank` 뿐이다. **문자 화이트리스트가 없으므로 콜론도 물리적으로는 저장된다.** 즉 `dept:` 가 막히지는 않는다. 그래도 콜론은 세션 키(`agent:<id>:<key>`)의 구분자와 URL 경로에서 이미 의미를 가지는 문자라, 로그·필터·복붙 경로에서 헷갈릴 여지만 늘린다. 바꿔서 얻을 것이 없다.

접두사는 설정으로 바꿀 수 있다(`gateway.auth.ixAuth.departmentGroupPrefix`). 빈 문자열이면
모든 그룹이 부서로 읽힌다.

> **가정(사용자 미확정)**: 부서 코드 체계를 `dept-<slug>` 로 고정한 것, 에이전트 1개가 부서 1개에
> 묶인다는 것, 미바인딩 에이전트를 공용으로 두는 것은 감독 판단이다. 고객 요건이 다르면 바꾸고
> 바꾼 값을 이 문서에 적는다.

## 6. 스키마

### 6.1 승인 근거 (AGENTS.md 요구)

루트 `AGENTS.md` 는 SQLite 스키마 변경에 **채팅에서의 명시 승인**을 요구하고,
`docs/reference/database-schemas.md` 의 review checkpoint 는 "표를 하나 추가하는 것" 을 항상
material 로 본다.

**감독자가 이 설계를 승인했다.** B 단계 착수 지시가 `departments` / `department_members` 를
이름으로 지정했고(계획 2.4 의 부서 3표), 다대다 소속·역할 직교·에이전트 태그까지 확정해서
내려왔다. 아래가 승인 대상의 전문이다.

**무엇을 왜 추가하는가**

| 표                   | 무엇                              | 왜                                                                                               |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `departments`        | slug + 표시 이름 + 생성/갱신 시각 | 부서를 1급 객체로 만들어 CLI 목록·바인딩 검증이 가능해진다. 로그인에서 처음 보는 코드도 등록된다 |
| `department_members` | (부서, 프로필) 다대다 + 동기 시각 | 운영자가 "이 부서에 누가 있는가" 를 볼 수 있게 한다. 회수가 눈에 보이게 남는다                   |
| `department_agents`  | 에이전트 -> 부서 (agent_id 가 PK) | 경계 자체. 세션이 아니라 에이전트에 긋는다(6.3)                                                  |

**canonical vs derived**: IX-Auth 가 정본이다. `department_members` 는 투영이고 **인가에 쓰지
않는다**(4절·7절). `department_agents` 만 포크가 소유하는 원본 데이터다.

**downgrade 안전성 판정**: 신규 표 3개뿐이고 기존 표·컬럼·인덱스를 건드리지 않는다. `docs/reference/database-schemas.md` 가 "New tables qualify because older builds ignore them" 이라고 명시하므로 **`user_version` 을 올리지 않는다**(공유 상태 DB 는 15 그대로). `ix_auth_login_sessions` · `user_profiles` 와 같은 **feature-local DDL** 방식이라 `openclaw-state-schema.sql` 에도 넣지 않는다. 이 모드를 안 쓰는 배포는 표 자체가 생기지 않으므로 `openclaw-state-db-contract.ts` 의 first-use 목록도 건드릴 것이 없다. 설치는 `ensureDepartmentsSchema` 의 first-use lazy ensure 한 번이고, `WeakSet` 캐시는 커밋된 뒤에만 채운다(롤백된 트랜잭션이 재시도 가능해야 한다).

**되돌리기**

```text
1. tools.sessions.visibility 를 "self" 로 되돌린다. 그 즉시 강제가 꺼진다
   (게이트가 만들어지지 않으므로 코드 경로가 통째로 비활성)
2. 게이트웨이 재시작
3. 세 표는 남겨 둔다. 구버전은 모르는 표를 무시한다
   - 정말 지우려면 DROP TABLE department_agents, department_members, departments
   - 지워도 다음 로그인이 departments·department_members 를 다시 채운다.
     다시 만들어야 하는 것은 department_agents(에이전트 바인딩)뿐이다
4. IX-Auth 그룹은 그대로 둔다. 강제가 꺼지면 클레임은 principal 까지만 오고 아무것도 막지 않는다
```

**검증 한계**: 구버전 open/use -> 신버전 reopen 실측은 하지 않았다. 신규 표만 추가하는 경우에
문서가 명시적으로 허용하는 경로이지만, 계획 2.4 가 요구한 왕복 실측은 남은 항목이다(11절).

### 6.2 DDL

`src/state/departments-schema.ts` 가 정본이다.

```sql
CREATE TABLE IF NOT EXISTS departments (
  slug TEXT NOT NULL PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS department_members (
  department_slug TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (department_slug, profile_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_department_members_profile
  ON department_members(profile_id);

CREATE TABLE IF NOT EXISTS department_agents (
  agent_id TEXT NOT NULL PRIMARY KEY,
  department_slug TEXT NOT NULL,
  assigned_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_department_agents_department
  ON department_agents(department_slug, agent_id);
```

계획 2.4 초안과 다른 점과 이유:

| 초안                                                | 지금                               | 이유                                                                             |
| --------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| `departments(id PK, slug UNIQUE, status, revision)` | `departments(slug PK)`             | 별도 id 는 조인만 늘린다. status·revision 을 읽는 코드가 없다(안 쓰는 컬럼 금지) |
| `department_members(profile_id PK)` = 1인 1부서     | `(department_slug, profile_id)` PK | 감독자 확정: 1인 다부서                                                          |
| `REFERENCES user_profiles(id)` 외래키               | 없음                               | `user_profiles` 도 feature-local 이라 생성 순서를 가정할 수 없다                 |
| `assigned_by_profile_id`                            | 없음                               | 바인딩은 호스트 운영자의 CLI 행위라 게이트웨이 프로필이 없다                     |

### 6.3 왜 세션에 부서를 찍지 않는가

계획 1.1 (D) 의 채택안이 이미 "1차는 불변 `agentId -> departmentId` 로 세션 부서를 결정" 이다.
그 판단을 그대로 따랐고, 근거를 다시 적는다.

- 세션은 `session_nodes.entry_json` 안에 살고, 그 DB 는 **에이전트별**이다. 세션은 에이전트를
  가로지를 수 없다. 즉 에이전트가 이미 소유자 경계다.
- 세션에 따로 찍으면 정본이 둘이 된다. `rnd` 로 찍힌 세션이 `qa` 에이전트에 있으면 무엇이 이기나?
- 이미 있는 세션 전부에 backfill 이 필요해진다. 파생값은 backfill 이 필요 없다.
- 사람이 부서를 옮겨도 데이터는 따라 움직이지 않는다. 생성자 기준으로 파생하면 이직 한 번에
  과거 세션이 통째로 새 부서로 넘어간다.

## 7. 강제 지점

**전부 서버가 판정한다.** UI 는 서버가 준 것만 그린다. 목록에서 빠지는 것과 직접 URL 이 막히는
것이 둘 다 필요하고, 아래가 그 두 짝이다.

| 파일                                                       | 무엇을 막는가                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/gateway/department-access.ts`                         | **판정 소유자.** 게이트 준비·에이전트 판정·행 술어·캐시 차원                |
| `src/gateway/session-sharing-policy.ts`                    | `isGatewayAdmin` 전역 통과 **앞** 부서 검사, 공유 대상 인가, 변경 인가      |
| `src/gateway/server-methods/sessions-board-inventory.ts`   | 세션 목록 행 필터 (에이전트 id 가 행마다 있는 유일한 자리)                  |
| `src/gateway/server-methods/sessions-list-cache.ts`        | 목록 캐시 키에 부서 차원 추가 (없으면 첫 호출자의 페이지가 남에게 재생된다) |
| `src/gateway/server-methods/sessions-read-by-key.ts`       | `sessions.describe` · `sessions.get` 직접 열람                              |
| `src/gateway/server-methods/chat-history-handler.ts`       | `chat.history` · `chat.startup` 전사                                        |
| `src/gateway/sessions-history-http.ts`                     | HTTP 전사 `/sessions/:key/history` (JSON·SSE 재검사 둘 다)                  |
| `src/gateway/session-sharing.ts`                           | `canReceiveSessionEvent` 이벤트 팬아웃                                      |
| `src/gateway/operator-role-policy.ts`                      | `authorizeGatewaySessionCreation` - 생성·실행 시작 **10여 곳을 한 번에**    |
| `src/gateway/server-methods/agents.ts`                     | `agents.list` - **카탈로그 준비 전에** 허용 ID 를 좁힌다                    |
| `src/gateway/session-utils-store.ts`                       | 로스터 투영 상한 + 걸러진 `defaultId` 재지정                                |
| `src/gateway/server-methods/session-catalog-visibility.ts` | 외부 CLI 카탈로그는 부서 강제 시 생성자 전용으로 내려간다                   |
| `src/gateway/auth.ts` · `http-auth-utils.ts`               | 검증된 부서를 **생산 지점에서** HTTP 요청 인가에 싣는다                     |
| `src/gateway/inbound-media-access.ts`                      | **채팅 첨부 열람.** 참조 자체로 판정한다(7-1)                              |
| `src/gateway/openai-http.ts` · `openresponses-http.ts`     | Gateway 클라이언트가 없는 표면도 생성 게이트를 지나게 한다                  |

계획 3.2 의 훅 10곳 표 대비:

| 계획 3.2 항목                                   | 상태                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `agents.list` 카탈로그 준비 전 좁히기           | 완료                                                                                                                               |
| `canReceiveSessionEvent` 이벤트 술어            | 완료                                                                                                                               |
| `createSessionListEntryFilter` 목록 술어        | 완료 (에이전트 id 가 있는 `listFilter` 자리에 결합)                                                                                |
| `session-sharing-policy` `isGatewayAdmin` 앞    | 완료                                                                                                                               |
| `authorizeSessionSharingTarget` 선행            | 완료                                                                                                                               |
| `invalidateOperatorRolePolicy` 확장             | 완료 (부서 변경이 같은 access revision 을 올린다. 8절)                                                                             |
| `resolveEffectiveSessionToolsVisibility`        | 완료 (모드 union 확장. 도구 축 의미는 4절)                                                                                         |
| `server-methods.ts` pre-dispatch / commit guard | **불필요.** 부서 판정이 `authorizeResolvedSessionMutation` 안에 있어 기존 pre-dispatch 가 그대로 태운다. 중복 관문을 만들지 않았다 |
| `users.ts` 역할 변경 감사                       | **범위 밖.** 역할은 IX-Auth 가 소유한다(포크에 사용자 관리 화면이 없다)                                                            |

### CLI

| 명령                                                   | 게이트웨이 경유 | 부서 강제                                             |
| ------------------------------------------------------ | --------------- | ----------------------------------------------------- |
| `openclaw agents department`                           | 아니오          | **운영자 명령.** 바인딩을 바꾸는 쪽이다               |
| `openclaw sessions archive` · `delete`, `--url` 타게팅 | 예              | 걸린다 (같은 `sessions.list` · `agents.list` 를 탄다) |
| `openclaw agents list`, `openclaw sessions`            | 아니오          | **안 걸린다.** 로컬 설정·스토어를 직접 읽는다         |

마지막 줄이 한계다. 게이트웨이 **호스트에 셸이 있는 사람**은 부서 경계 밖이다 - 그 사람은
SQLite 파일을 직접 열 수도 있으므로 애초에 경계 안쪽이 아니다. 부서는 **브라우저로 들어오는
사람들** 사이의 경계이고, 호스트 접근은 별도(OS 권한)로 통제한다. 바인딩 명령을 게이트웨이
메서드가 아니라 CLI 에 둔 것도 같은 이유다: 자기를 가두는 펜스를 옮길 수 있는 브라우저 세션은
펜스가 아니다.

## 7-1. 채팅 첨부 경계 (2026-09-08, N 단계)

세션과 전사에는 부서 경계가 걸려 있었지만 **채팅에 올린 파일에는 걸려 있지 않았다.** 첨부는 미디어 id 하나로만 서빙되고, 그 id 를 아는 사람은 로그인만 돼 있으면 누구든 파일을 받을 수 있었다.

무엇이 뚫려 있었나:

| 지점 | 문제 |
| --- | --- |
| `src/gateway/control-ui.ts` 의 `/__openclaw__/assistant-media` | `sessionKey` 가 **선택** 파라미터라, 빼고 부르면 세션 검사가 아예 만들어지지 않았다 |
| `src/media/local-media-access.ts` | 인바운드 참조는 자기 부모 디렉터리를 루트로 삼아 폴더 컨테인먼트를 항상 통과한다 |
| 저장 시점 | 전사에 `media://inbound/<id>` 만 남고 누가 어느 세션에서 올렸는지가 어디에도 없었다 |

### 7-1-1. 소유권을 먼저 기록한다

정본은 공용 SQLite 의 feature-local 표 `inbound_media` 다(DDL `src/state/inbound-media-schema.ts`, 접근 `src/state/inbound-media-store.ts`).

```sql
CREATE TABLE IF NOT EXISTS inbound_media (
  id TEXT NOT NULL PRIMARY KEY,   -- 미디어 저장소가 발급한 id
  session_key TEXT,
  agent_id TEXT,
  profile_id TEXT,                -- 신원 서버 계정. 토큰 모드에서는 NULL
  original_name TEXT,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER              -- 세션 삭제 표시. 지우지는 않는다
) STRICT;
```

**부서 열은 일부러 두지 않았다.** 세션에 부서를 찍지 않은 것과 같은 이유다(6-3): 첨부는 세션 안에 있고 세션은 에이전트 안에 있으므로 에이전트가 이미 경계다. 부서는 매번 `department_agents` 에서 `agent_id` 로 파생한다. 두 번 적으면 정본이 둘이 되고, 에이전트가 부서를 옮길 때마다 backfill 이 필요해진다.

행을 쓰는 자리는 첨부가 디스크에 남는 그 지점 하나다: `persistInboundImagesForTranscript` 를 감싸는 `src/gateway/server-methods/chat-send-user-turn.ts` 의 `persistChatSendImages`, 기록 본체는 `src/gateway/inbound-media-ownership.ts`. 이미지와 비이미지를 모두 남긴다. 기록이 실패해도 첨부 전송 자체는 진행한다. 행이 없으면 소유자가 없는 것이고, 그러면 시스템 관리자 외에는 아무도 못 여는 안전한 방향으로 실패한다.

### 7-1-2. 판정

정본은 `src/gateway/inbound-media-access.ts` 의 `authorizeInboundMediaRead` 하나다. 순서가 곧 규칙이다.

1. `gateway.auth.mode` 가 `ix-auth` 가 아니면 통과. 공용 비밀 하나로 들어오는 배포에는 첨부를 귀속시킬 계정이 없다.
2. 시스템 관리자는 전부 통과.
3. `inbound_media` 행이 없으면 **404**. 이 표가 생기기 전에 올라온 파일(레거시)이 여기 걸린다.
4. 요청자 프로필이 소유자면 통과.
5. 그 첨부의 에이전트가 요청자의 부서에서 보이지 않으면 404. **관리자 통과는 이 검사 뒤에 있다.** 세션 공유 정책과 같은 순서라, 한 부서의 관리자가 다른 부서 첨부를 열 수 없다.
6. 나머지는 그 세션이 요청자에게 보일 때만 통과한다(`createProfileSessionEntryFilter` + 역할별 `sessions.others` 상한).

`sessionKey` 파라미터는 판정에 쓰지 않는다. 참조 문자열 자체에서 미디어 id 를 뽑고, `media://inbound/<id>` 형태와 저장소 안 절대경로 형태를 **둘 다** 같은 게이트에 태운다(`readInboundMediaIdFromSource`). 티켓 경로(`mediaTicket`)도 같은 판정을 받는다. 티켓의 reader 에 검증된 부서 사실을 같이 실어 두었다(`AssistantMediaReader.departments`, HMAC 서명 안).

거부는 **404** 이고(존재 은닉, 4절과 같은 관례), 감사 원장에 `access_denied` 로 남는다. detail 은 `{ reason, surface: "assistant-media", mediaId }` 다(`recordInboundMediaDeniedActivity`).

**같은 미디어를 내려주는 다른 경로**: `src/gateway/channel-avatar-http.ts` 도 인바운드 파일을 서빙하지만 호출자가 준 id 가 아니라 세션 저장소가 들고 있는 아바타 참조를 읽고, 그 전에 세션 소유자 권한을 요구한다. 임의 id 로 부를 수 없어 같은 결함이 아니다.

### 7-1-3. 재참조 도구도 같은 경계를 쓴다

`media_list` 와 `media_read` 는 도구 쪽 경계를 따로 만들지 않는다. 세션의 생성자 프로필이 소유자이고, 첨부가 기록된 에이전트의 부서 바인딩이 현재 에이전트의 것과 같아야 한다. 상세는 [FILE-PREVIEW.md](FILE-PREVIEW.md) 8절.

### 7-1-4. 세션을 지우면

`sessions.delete` 가 그 세션의 `inbound_media` 행에 `deleted_at` 만 찍는다(`softDeleteInboundMediaForSession`). 파일은 즉시 지우지 않는다. 이유 둘.

- 사용자 요구가 "올린 파일은 나중에도 참조 가능해야 한다" 이고,
- 감사 원장이 90일 동안 "누가 무엇을 열었나" 를 답해야 하는데 소유 사실이 사라지면 그 행을 설명할 수 없다.

표시가 찍힌 행은 재참조 도구 두 개에서 사라진다. 소유자 판정 자체는 그대로 남으므로 남이 열 수 있게 되지는 않는다.

## 8. 동기화 시점과 반영 지연

```text
로그인 (POST /auth/login)
  -> 토큰 검증 -> user_profiles 확정 -> ix_auth_login_sessions 행 생성
  -> syncIxAuthDepartments(profileId, 토큰의 부서 코드)
       - 클레임에서 사라진 소속은 여기서 삭제된다 (회수)
       - 집합이 실제로 바뀐 경우에만 invalidateOperatorRolePolicy()
         = 역할 변경과 같은 access revision 을 올린다

WS 연결 (핸드셰이크)
  -> principal.departments / isSuperAdmin 을 client.internal.ixAuthDepartments 에 고정
     (토큰 자체는 싣지 않는다 - 오래 사는 객체에 비밀을 두지 않는다)

매 요청
  -> prepareDepartmentGate 가 department_agents 를 읽어 판정
     (캐시하지 않는다. 운영자가 바인딩을 바꾸면 재시작 없이 즉시 반영된다)
```

**반영 지연**: 열려 있는 WS 는 핸드셰이크 시점의 부서를 유지한다. 부서를 바꿔도 그 연결은
재접속 전까지 옛 부서로 동작한다 - 역할 변경의 최대 15분 창(AUTH-IXAUTH 7.3)과 같은 성격이다.

| 하고 싶은 것       | 방법                                           | 반영 시점                                                |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------- |
| 부서 이동          | 콘솔에서 그룹 변경                             | 그 사람의 **다음 로그인**                                |
| 지금 당장 반영     | 위 + 콘솔에서 그 사람의 세션 종료              | 즉시. 토큰 갱신이 실패해 세션 행이 폐기되고 WS 가 끊긴다 |
| 에이전트 부서 변경 | `openclaw agents department --agent X --set Y` | **즉시** (매 요청 읽는다)                                |

## 9. 운영 절차

### 9.1 부서 추가

```bash
# 1) IX-Auth 콘솔(/admin/identity/)에서 그룹 생성: 코드 dept-<slug>, 이름은 표시용
#    또는 관리 API:
#    POST /admin/groups {"code":"dept-rnd","name":"연구개발"}
#    주의: 그룹에 역할을 붙이지 마라. 역할과 부서는 직교해야 한다

# 2) 그 부서 에이전트를 만들고 묶는다
openclaw agents add rnd-bot          # 워크스페이스·스킬은 에이전트 단위로 이미 분리돼 있다
openclaw agents department --agent rnd-bot --set rnd

# 3) 확인
openclaw agents department --json
```

### 9.2 사용자 배치

IX-Auth 콘솔에서 그룹 멤버로 넣는다(`POST /admin/groups/{id}/members {"userId":N}`).
포크 쪽에 할 일은 없다 - 그 사람의 다음 로그인이 `department_members` 를 채운다.

역할은 따로 준다(`PUT /admin/users/{id}/roles`). **본문 필드는 `roles` 다.**
`{"codes":[...]}` 로 보내면 서버가 400 을 내지 않고 조용히 기본 역할(`USER`)로 되돌려 버린다 -
실제로 이 검증 중에 superadmin 을 그렇게 강등시켰다(11절 결함 4).

### 9.3 부서에서 빼기

콘솔에서 그룹 멤버를 지운다. 다음 로그인에 `department_members` 에서 사라진다.
즉시 끊으려면 그 사람의 IX-Auth 세션을 종료한다(8절).

### 9.3-1 부서 삭제 (K 단계)

`/settings/departments` 에서 부서를 고르면 "삭제" 행이 나온다. 시스템 관리자 전용이고, 두 번 눌러야 지운다.

```
DELETE /auth/admin/departments   {"slug":"rnd"}
  -> 200 {"slug":"rnd","unboundAgents":["rnd-bot"]}
  -> 409 {"error":"department_has_members","memberCount":2}
```

지키는 것이 넷이다.

- **비어 있어야 지운다.** 인원수는 신원 서버의 `GET /admin/groups/{id}/members` 를 먼저 보고, 그 호출이 실패했을 때만 로컬 투영(`department_members`)으로 판정한다. 투영만 믿으면 **아직 한 번도 로그인하지 않은 사람이 안 보인다.** 사람이 남아 있으면 409 로 거부하고, 화면은 구성원 패널에서 먼저 빼라고 말한다.
- **그룹 먼저, 투영 나중.** 신원 서버의 `DELETE /admin/groups/{id}` 를 먼저 부르고 성공했을 때만 포크 쪽 `departments`·`department_members`·`department_agents` 행을 지운다. 중간에 실패하면 화면이 이미 아는 "신원 서버에 없는 부서"(고아) 상태로 남는다. 반대 순서였다면 **아무도 못 보는 살아 있는 그룹**이 남아 사람이 계속 배치될 수 있다.
- **고아 행은 그룹 호출 없이 지운다.** 신원 서버가 더는 나열하지 않는 부서는 지울 그룹이 없으므로 투영만 치운다.
- **풀려난 에이전트의 폴더도 회수한다.** 게이트웨이의 이 경로는 설정을 쓰지 못하므로, 답에 담긴 `unboundAgents` 를 화면이 받아 에이전트마다 `config.patch` 로 `workspace`·`skipBootstrap`·`tools.profile`·`tools.permissionMode`·`memory.search.extraPaths` 를 비운다. 이 정리가 실제로 접근을 닫는 부분이다. 브라우저를 거치지 않고 API 만 직접 부르면 **에이전트가 사라진 부서의 폴더를 계속 들고 있다.**

**이름 변경은 여전히 표시 이름만 바꾼다.** 신원 서버에 그룹 이름을 고치는 경로가 없다(`/admin/groups` 는 생성·삭제·구성원·역할뿐이다). 삭제 후 같은 코드로 다시 만드는 것은 구성원을 전부 잃는 행위라 이름 변경의 대안이 아니다. 표시 이름은 `departments.display_name` 한 곳에 있고, 사용자 표·감사 표·부서 화면·초대 화면·사용자 상세가 모두 이 이름을 읽는다(K 단계에서 감사 표만 코드를 그대로 찍고 있던 것을 고쳤다).

### 9.4 진단

| 증상                                  | 확인                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| 부서가 안 잡힌다                      | `GET /auth/me` 의 `user.departments`. 비어 있으면 그룹 코드에 `dept-` 접두 확인             |
| 강제가 안 걸린다                      | `tools.sessions.visibility` 가 `"department"` 인지, `gateway.auth.mode` 가 `"ix-auth"` 인지 |
| 자기 부서 세션도 안 보인다            | `openclaw agents department --json` 으로 그 에이전트가 어디에 묶였는지                      |
| 남의 부서 세션이 404 가 아니라 보인다 | 그 에이전트가 아무 부서에도 안 묶여 있다(공용). 묶어야 한다                                 |
| 부서를 바꿨는데 그대로다              | 열린 WS 가 옛 부서를 들고 있다. 재로그인 또는 콘솔에서 세션 종료(8절)                       |

## 10. 되돌리기

6.1 의 되돌리기 절차와 같다. 한 줄 요약: **`tools.sessions.visibility` 를 `"self"` 로 되돌리고
재시작하면 끝난다.** 표를 지울 필요도, IX-Auth 그룹을 지울 필요도 없다.

## 11. 라이브 검증 기록 (2026-09-07, compose 스택 18800)

전체 명령·응답 로그와 스크린샷 목록은
`D:\PROJECT\chris-server\analysis\2026-09-07-openclaw-auth\dept-live-verification.log`.

구성: IX-Auth 그룹 `dept-rnd`·`dept-qa`, 사용자 6명(역할 4종 x 부서 2개가 겹치도록 + 미배정 +
superadmin), 에이전트 3개(`rnd-bot`->rnd, `qa-bot`->qa, `main` 미바인딩).

| #   | 시나리오                           | 결과                                                                   |
| --- | ---------------------------------- | ---------------------------------------------------------------------- |
| 1   | 로그인 시 부서 투영                | 통과. 바인딩 직후 `members=0` -> 로그인 후 `rnd=2, qa=2`               |
| 2   | rnd 사용자 세션 목록               | 통과. 자기 세션 1건만. qa 세션 없음                                    |
| 3   | rnd 사용자가 qa 세션 URL 직접 입력 | 통과. "was not found"                                                  |
| 4   | HTTP 전사 교차 접근                | 통과. 자기 부서 **200** / 남의 부서 **404**. 반대 방향(qa->rnd)도 대칭 |
| 5   | superadmin 양성 대조군             | 통과. 두 부서 전사 모두 200, 세션 3건, 에이전트 메뉴 4개 전부          |
| 6   | 에이전트 선택                      | 통과. rnd 사용자 메뉴에 QA Bot 없음                                    |
| 7   | admin(rnd) 경계                    | 통과. operator 권한이 있어도 세션 1건, 메뉴에 QA Bot 없음              |
| 8   | 미배정 사용자                      | 통과. 자기 세션 1건만, 에이전트 선택기 자체가 뜨지 않음                |

**거부 코드에 대하여**: 읽기 경로는 **404**(없다)로 답한다. 403(금지)으로 답하면 세션 키의 존재
여부가 새어 열거가 가능해진다. 403 은 **에이전트 사용 거부**에서 나온다
(`DEPARTMENT_ACCESS_DENIED`, `authorizeGatewaySessionCreation`).

### 11.1 실측으로 잡은 결함 4건

| #   | 증상                                                                      | 원인                                                                                                                     | 수정                                                                                                |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 1   | rnd 사용자가 `GET /sessions/<qa 키>/history` 로 QA 전사를 200 으로 받았다 | HTTP 전사 경로가 만드는 합성 클라이언트에 검증된 부서가 실리지 않아 "부서 없는 호출자" 로 인가됐다                       | 부서를 `GatewayAuthResult` -> 요청 인가 -> 합성 클라이언트까지 생산 지점에서 싣고, 공용 술어로 통일 |
| 2   | Gateway 클라이언트를 만들지 않는 HTTP 표면이 생성 게이트를 건너뛰었다     | `openai-http`·`openresponses-http` 가 `client` 대신 `profileId` 를 넘겨 부서 분기 자체를 지나쳤다                        | 게이트가 신원만으로도 판정하게 하고 두 표면이 부서를 명시적으로 전달                                |
| 3   | 기본 진입 화면이 "was not found" 로 죽었다                                | 미바인딩 에이전트를 생성자 전용으로 두어 공용 홈 세션이 최초 생성자 전용이 됐다                                          | 규칙 변경(2절). 미바인딩은 파티션 밖, 미배정자만 좁힌다                                             |
| 4   | superadmin 이 관리 API 403 으로 잠겼다                                    | `PUT /admin/users/{id}/roles` 의 본문 필드는 `roles` 인데 `codes` 로 보냈다. **서버가 400 대신 조용히 USER 로 되돌린다** | 이번엔 DB 로 복구. IX-Auth 쪽 견고성 문제로 기록(12절)                                              |

## 12. 남은 것 · 알려진 한계

| 항목                                                      | 상태                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.history` 의 **일반** 가시성 필터 부재               | **선재 결함.** `sessions.get` 과 달리 역할 상한 행 필터가 없다. 이번엔 부서 펜스만 넣었다 - 기존 모드의 동작을 바꾸는 변경이라 별도 심사가 필요하다   |
| 같은 부서의 다른 에이전트 간 모델 도구 열람               | 미구현. 도구 축은 보수적으로 에이전트 경계로 판정한다(4절)                                                                                            |
| `human-mention-policy` 의 생성 게이트                     | 채널 발신 경로라 검증된 IX-Auth principal 이 없다. 부서 전달 대상 아님                                                                                |
| 로컬 CLI(`agents list`·`sessions`)                        | 게이트웨이를 안 탄다. 호스트 셸 = 경계 밖(7절)                                                                                                        |
| 구버전 open/use -> 신버전 reopen 왕복 실측                | 미실시(6.1)                                                                                                                                           |
| 부서별 감사 원장                                          | 미구현. AUTH-IXAUTH 6.3 의 조건이던 6.1 이 이번에 충족됐으므로 이제 착수 가능                                                                         |
| IX-Auth `replaceRoles(null)` 이 조용히 기본 역할로 되돌림 | 벤더 트리 이슈. `MODULE.md` 경계상 포크가 고칠 수 있으나 이번 범위 밖. 운영 절차 9.2 에 경고를 남겼다                                                 |
| 부서 이름 변경이 신원 서버에 반영되지 않음                | 벤더에 그룹 이름 변경 API 가 없다(`/admin/groups` 는 생성·삭제·구성원·역할만). 게이트웨이 표시 이름만 바뀌고, 콘솔에는 원래 그룹 이름이 남는다(9.3-1) |
| 부서 삭제 후 에이전트 폴더 회수는 화면이 한다             | 게이트웨이의 삭제 경로는 설정을 쓰지 못한다. API 만 직접 부르면 풀려난 에이전트가 사라진 부서의 워크스페이스·색인 폴더를 계속 들고 있다(9.3-1)        |

## 13. 폴더 단위 접근은 에이전트 워크스페이스로 (경로 A)

> G 단계에서 추가. 근거는 `infra/local/openclaw-jinbio-nas-feasibility.md` 6절의 "경로 A" 결론이고,\
> 계획 반영은 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 3-1 절이다. 설치 절차는 [DEPLOY.md](DEPLOY.md) 11절.

### 13.1 규칙 한 줄

**에이전트 1개 = 허용 폴더 1개.** 그 폴더가 그 에이전트의 워크스페이스다.

부서 단위로 나눌 수도 있고(`rnd-bot` -> 연구개발 공유), 사람 단위로 나눌 수도 있다(`kim-bot` -> 그 사람 폴더).\
어느 쪽이든 판정 단위는 같다. 사람이 아니라 **에이전트**가 폴더를 갖고, 부서 게이트(2절)가 그 에이전트에 누가 닿을지를 정한다.

### 13.2 화이트리스트만 쓴다

| 방식                                          | 이 배포에서 |
| --------------------------------------------- | ----------- |
| 허용할 폴더를 워크스페이스로 준다             | **채택**    |
| 기본은 다 보이고 특정 폴더만 차단 목록에 둔다 | 미채택      |

**안 넣으면 차단된다.** 마운트하지 않은 폴더는 컨테이너 안에 아예 존재하지 않으므로,\
차단 규칙을 하나도 쓰지 않고도 통제가 성립한다. 인사·급여 공유(`hr/`)를 compose 볼륨 목록에서\
빼 둔 것이 그 실증이고, 샘플 트리 `nas-sample/hr/` 가 그 자리를 표시한다.

블랙리스트를 쓰지 않는 이유는 실패 방향이 반대이기 때문이다. 기본 허용 + 특정 차단은 **목록에서\
빠뜨린 폴더가 그대로 열린 문**이 된다. 새 공유가 하나 생길 때마다 차단 목록을 갱신해야 하고, 갱신을\
잊은 쪽이 유출이다. 화이트리스트는 갱신을 잊으면 안 보인다. 특히 LLM 에이전트는 경로를 스스로 지어내\
훑기 때문에, "빠뜨리면 열린다" 는 구조를 주면 안 된다.

### 13.3 3중 잠금

부서 에이전트에는 세 가지를 함께 건다. 하나만으로는 부족해서가 아니라, 각각이 막는 것이 다르다.

| 설정                                | 무엇을 막는가                                                       |
| ----------------------------------- | ------------------------------------------------------------------- |
| `tools.profile: "readonly"`         | 도구 목록 자체를 읽기류로 좁힌다. 새로 생긴 도구는 기본 제외        |
| `tools.permissionMode: "read-only"` | 세션 기본 권한 모드. 세션이 이보다 올리려면 ADMIN 스코프가 필요하다 |
| `tools.fs.workspaceOnly: true`      | 파일 도구의 경로를 워크스페이스 밖으로 못 나가게 한다               |

여기에 마운트가 `:ro` 라서 컨테이너 파일시스템이 네 번째 방어선이 된다.\
쓰기가 성공하면 그 자체가 배선 오류의 신호다.

**세 잠금 중 앞의 둘은 네이티브 런타임의 도구 목록과 세션 권한에 걸리고, 세 번째는 파일 도구의 경로\
검사에 걸린다.** 셋 다 모델이 파일을 `read` 도구로 읽는다는 전제 위에 있다. codex 하네스는 파일을\
자기 셸로 읽으므로 그 전제가 깨진다. 13.9 를 보라.

### 13.4 셸이 열려 있으면 3중 잠금이 무너진다

셸이 열려 있으면 위의 3중 잠금이 의미를 잃는다. 파일 도구의 경로 검사는 파일 도구에만 걸리고,\
셸은 `cat`·`find` 로 임의 경로를 읽는 별도의 통로이기 때문이다. 한 곳만 새도 화이트리스트가 무너지는\
구조라, 파일 서버 용도 에이전트에서는 셸을 닫는다. 셸이 필요한 작업은 부서 에이전트가 아니라\
다른 에이전트에서 한다.

네이티브 런타임에서 셸을 닫는 것은 `tools.profile: "readonly"` 다. readonly 프로필은 허용 목록이라\
`exec`·`process` 가 애초에 들어오지 않는다(`src/agents/tool-catalog.ts:475`).

G 단계 템플릿에는 부서 에이전트마다 `tools.exec.mode: "deny"` 와 `tools.fs.workspaceOnly: true` 를\
한 번 더 적어 두었다. 둘 다 이미 성립하는 값을 되풀이한 것이라(readonly 프로필이 exec 을 빼고,\
전역 `tools.fs.workspaceOnly` 가 이미 참이다) 판정을 바꾸지 않으면서 기동마다 경고만 남겼다.

```text
tools policy: profile "readonly" (agent "rnd-bot") has configured tool sections
(tools.exec / tools.fs) that no longer implicitly widen the profile.
```

경고의 뜻은 "프로필과 함께 적은 `tools.exec`·`tools.fs` 절이 예전처럼 프로필을 넓혀 주지 않는다" 이고,\
판정은 `detectImplicitProfileGrants`(`src/agents/agent-tools.policy.ts:322-341`)와 그 호출부\
(같은 파일 `423-465`)에 있다. 넓힐 의도가 없었으므로 두 절을 템플릿에서 지웠다.\
부서 에이전트에 남은 것은 `profile` 과 `permissionMode` 두 줄이다.\
에이전트 `tools.fs` 를 지워도 경계는 그대로다. 값이 없으면 전역 `tools.fs` 로 떨어지기 때문이다\
(`resolveToolFsConfig`, `src/agents/tool-fs-policy.ts:15-25`).\
`tools.exec.mode` 의 유효값 자체는 그대로 `deny`·`allowlist`·`ask`·`auto`·`full` 이다\
(`src/config/zod-schema.agent-runtime.ts:528`, 타입은 `src/infra/exec-approvals-core.ts:12`).

**이 절이 성립하는 것은 네이티브 런타임에서다.** codex 하네스에서는 성립하지 않는다. 13.9 를 보라.

### 13.5 NAS 공유가 에이전트에 닿는 3단계

```text
1) 호스트    SMB(cifs) 또는 NFS 로 NAS 공유를 마운트한다      -> /srv/nas/rnd
2) compose   그 폴더를 컨테이너에 읽기 전용으로 넣는다        -> /mnt/nas/rnd:ro
3) 설정      그 경로를 에이전트 워크스페이스로 지정한다        -> rnd-bot.workspace
```

`OPENCLAW_NAS_ROOT` 는 1단계 결과의 **부모 디렉터리**다. compose 가 그 아래 `rnd`·`qa` 를 찾아 마운트하고,\
`start-gateway.sh` 가 그 값이 비어 있지 않을 때만 3단계 워크스페이스를 마운트 경로로 바꾼다.\
값이 비면 부서 에이전트는 각자 상태 디렉터리 안의 쓰기 가능한 워크스페이스를 그대로 쓴다.\
기본값은 저장소 안의 샘플 트리 `chris-local/nas-sample` 이라 NAS 없이도 배선을 확인할 수 있다.

호스트 마운트 명령과 `/etc/fstab` 예시는 [DEPLOY.md](DEPLOY.md) 11.4 에 있다.

### 13.6 에이전트 만들고 부서에 묶기

```bash
# 1) 부서 그룹은 IX-Auth 콘솔에서 먼저 만든다 (코드 dept-<slug>). 9.1 참고

# 2) 에이전트를 만든다. 워크스페이스가 곧 허용 폴더다
openclaw agents add rnd-bot --workspace /mnt/nas/rnd --non-interactive

# 3) 부서에 묶는다
openclaw agents department --agent rnd-bot --set rnd

# 4) 확인
openclaw agents department --json

# 되돌리기: 공용 풀로 돌려보낸다
openclaw agents department --agent rnd-bot --clear
```

납품 스택처럼 설정 파일이 정본인 배포에서는 2번을 CLI 로 하지 않고\
`ixauth-gateway-config/openclaw.json` 의 `agents.entries` 에 직접 적는다. 3번은 CLI 로만 한다.\
바인딩은 설정이 아니라 상태 DB(`department_agents`)에 있고, 그 이유는 7절 마지막 문단에 있다.

`--set` 에 넣는 것은 **접두사를 뗀 slug** 다. 그룹 코드가 `dept-rnd` 면 `--set rnd` 다.

### 13.7 읽기 전용 워크스페이스의 제약 (실측)

`:ro` 마운트를 워크스페이스로 주면 **첫 턴에 워크스페이스 부트스트랩이 실패한다.**

첫 턴 준비가 `ensureAgentWorkspace` 를 부르고(`src/agents/command/prepare.ts:368`),\
그 안에서 `AGENTS.md` 를 워크스페이스 안에 만든 임시 파일을 거쳐 발행한다\
(`src/agents/workspace.ts:319-393`). 대상 파일이 이미 있으면 건너뛰지만, NAS 공유에는 없으므로\
임시 파일 생성이 `EROFS` 로 떨어지고 그 예외가 그대로 턴을 죽인다.

끄는 스위치는 `skipBootstrap` 이다. 원래는 `agents.defaults.skipBootstrap` 전역 키 하나뿐이라\
NAS 워크스페이스를 켜면 `main` 을 포함한 이 배포의 모든 에이전트에서 `AGENTS.md`·`SOUL.md`·`BOOTSTRAP.md`\
생성이 함께 꺼졌다. G 단계에서 **에이전트별 키**를 추가해 그 결합을 끊었다.\
`agents.entries.<id>.skipBootstrap` 이 먼저이고 없을 때만 `agents.defaults.skipBootstrap` 으로 떨어진다\
(`resolveAgentSkipBootstrap`, `src/agents/agent-scope-config.ts`).

그래서 `start-gateway.sh` 는 `OPENCLAW_NAS_ROOT` 가 설정된 경우에만 `rnd-bot`·`qa-bot` 의\
`skipBootstrap` 을 `true` 로 렌더링한다. `main` 은 쓰기 가능한 워크스페이스를 그대로 쓰고\
부트스트랩 파일도 그대로 받는다.

같은 이유로 `<워크스페이스>/memory` 쓰기도 실패한다(경로는 `src/plugin-sdk/memory-host-core.ts:476`).\
읽기 전용 파일 서버 에이전트에는 의도된 결과이지만, 자동 기억을 쓰는 에이전트에 `:ro` 워크스페이스를\
주면 안 된다.

### 13.8 한계

| 항목                                                      | 상태                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 한 에이전트가 여러 폴더를 보되 사용자마다 부분집합만 필터 | **불가.** 도구 실행 컨텍스트에 사람 신원이 없다. 그것이 경로 B 이고 미채택이다                               |
| 에이전트 하나에 여러 폴더                                 | 불가. `workspace` 는 단수다. 폴더를 늘리려면 에이전트를 늘린다                                               |
| NAS 폴더 ACL 과의 동기화                                  | **없다.** NAS 쪽 권한과 이쪽 워크스페이스는 서로 모른다. 두 통제면을 각각 관리한다                           |
| NAS 사용자 목록과 IX-Auth 계정                            | 자동 연동 없음. 1회성 CSV 가져오기로 옮긴다([AUTH-USERS.md](AUTH-USERS.md) 6절, [DEPLOY.md](DEPLOY.md) 11.5) |
| 호스트 셸을 가진 사람                                     | 경계 밖이다(7절 마지막 문단). NAS 마운트를 직접 읽을 수 있다                                                 |

두 통제면을 각각 관리한다는 말의 뜻은 이렇다. NAS 에서 어떤 사람의 폴더 권한을 회수해도\
그 사람이 쓰던 에이전트는 그대로 그 폴더를 본다. 반대로 에이전트 바인딩을 바꿔도 NAS 의\
파일 탐색기 접근은 그대로다. 사람이 부서를 옮기거나 퇴사하면 **양쪽을 다 처리해야 한다.**

### 13.9 codex 하네스에서는 폴더 경계가 서지 않는다 (2026-09-08 실측)

**결론부터.** `openai/gpt-5.6-sol` 을 ChatGPT 구독 OAuth 로 붙이면 부서 에이전트는 codex 하네스에서\
돈다. 그 경로에서는 13.3 의 3중 잠금이 폴더 경계를 만들지 못한다. **읽기를 열면 다른 부서 폴더도\
같이 열린다.** 그래서 열지 않았고, 부서 에이전트는 그 경로에서 파일을 읽지 못한 채로 둔다.\
경계가 새는 것이 기능이 없는 것보다 나쁘다.

**증상.** 관리자가 `rnd-bot` 새 세션(권한 표시 "읽기 전용")에 "작업 폴더 문서들을 한 줄씩 요약하고\
summary.md 로 저장해줘" 를 보내면, 명령 2개를 실행한 뒤 "작업 폴더 접근 권한이 승인되지 않아\
문서를 읽거나 summary.md 를 생성할 수 없었습니다" 로 끝난다. 쓰기 거부는 의도지만 읽기까지 실패한다.

**전사에서 확인한 두 명령.** 세션 기록은 컨테이너의\
`/home/node/.openclaw/agents/rnd-bot/agent/codex-home/sessions/<날짜>/rollout-*.jsonl` 이다.

```text
1) rg --files -g '*.md' ... (cwd /mnt/nas/rnd)
   -> bwrap: No permissions to create a new namespace, likely because the kernel
      does not allow non-privileged user namespaces.
2) 같은 명령을 sandbox_permissions="require_escalated" 로 재시도
   -> exec_command failed: CreateProcess { message: "Rejected(\"rejected by user\")" }
```

같은 파일의 `turn_context` 는 `approval_policy=on-request`, `sandbox_policy={"type":"read-only"}`,\
`permission_profile={managed, file_system:{restricted, entries:[{path::root, access:read}]}}` 였다.\
번역 자체는 의도대로다. `permissionMode: "read-only"` 는 codex 의 `read-only` 샌드박스와 사용자 승인으로\
내려간다(`extensions/codex/src/app-server/session-permission-policy.ts:44-71`). 두 번째 명령이 거부된 것도\
읽기 전용 세션에서 권한 상승을 자동 거부한 정상 동작이다.

**원인 1: 컨테이너 안에서 codex 샌드박스가 아예 못 뜬다.** codex 는 리눅스에서 bubblewrap 으로\
샌드박스를 만들고, bubblewrap 은 사용자 네임스페이스를 필요로 한다. 도커 기본 seccomp 프로파일은\
`CAP_SYS_ADMIN` 이 없는 컨테이너에서 `unshare(CLONE_NEWUSER)` 를 막는다. 그래서 **읽기 명령까지 포함해\
모든 명령이 실패한다.** 게이트웨이 컨테이너에서 그대로 재현된다.

```bash
docker exec openclaw-ixauth-gateway-1 sh -lc 'unshare -Ur /bin/echo ok'
# unshare: unshare failed: Operation not permitted
```

**원인 2: 그 봉인을 풀어도 폴더 경계는 서지 않는다.** codex 의 `read-only` 샌드박스는 "쓰기 금지"이지\
"워크스페이스만 읽기"가 아니다. 위 `permission_profile` 의 `:root` 는 워크스페이스 루트가 아니라\
파일시스템 루트 `/` 로 풀린다(`resolveFsSpecialPath`,\
`extensions/codex/src/app-server/sandbox-exec-server/fs-policy.ts:132-135`).\
같은 이미지에서 그 프로파일을 그대로 넣고 확인한 결과다.

```bash
# seccomp 를 푼 일회용 컨테이너에서, 실제 턴이 쓰던 permission_profile 을 그대로 준다
codex sandbox --sandbox-state-json '{"sandboxCwd":"file:///mnt/nas/rnd","permissionProfile":
  {"type":"managed","file_system":{"type":"restricted","entries":[
  {"path":{"type":"special","value":{"kind":"root"}},"access":"read"}]},"network":"restricted"}}' \
  -- /bin/cat /mnt/nas/qa/README.md
# -> 다른 부서 문서가 그대로 출력된다
```

읽기 범위를 워크스페이스로 좁히려면 `entries` 를 `{"kind":"project_roots"}` 로 바꿔야 하고,\
그렇게 주면 실제로 `/mnt/nas/qa` 는 사라진다(같은 방식으로 확인). 그러나 턴마다 보내는\
app-server 프로토콜의 `sandboxPolicy` 에는 쓰기 루트(`writableRoots`)만 있고 읽기 루트를 좁힐 자리가 없다\
(`extensions/codex/src/app-server/protocol.ts:417`, 생성부는 `codexSandboxPolicyForTurn`,\
`extensions/codex/src/app-server/config-runtime.ts:532-542`).\
`--sandbox-state-json` 은 CLI 전용 표면이라 하네스가 쓰지 않는다.

**검토하고 기각한 것.**

| 안                                                           | 기각 이유                                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 컨테이너에 `cap_add: SYS_ADMIN` 을 주어 bubblewrap 을 살린다 | 원인 2 때문에 그 순간 `/mnt/nas/qa` 가 읽힌다. 셸을 살리는 것이 곧 경계를 여는 것이다                                                                           |
| 에이전트별 도커 샌드박스(`agents.entries.<id>.sandbox`)      | codex 하네스가 그 경로를 타기는 한다(`ensureCodexSandboxExecServerEnvironment`). 다만 게이트웨이 컨테이너에 도커 소켓을 넣어야 하고, 그것은 호스트 root 와 같다 |
| 부서 에이전트만 네이티브 런타임으로                          | **유일하게 성립하는 길이다.** 다만 구독 OAuth 프로필은 codex 경로에만 붙는다. API 키가 필요하다                                                                 |

**그래서 지금 지원되는 구성.** 부서 에이전트를 실제로 쓰려면 그 에이전트의 모델을 네이티브 런타임이\
받는 자격증명(API 키)으로 준다([DEPLOY.md](DEPLOY.md) 3.4 (가)). 네이티브 런타임에서는 파일 접근이\
`read` 도구를 지나고, 그 도구가 `tools.fs.workspaceOnly` 로 워크스페이스 밖을 막는다.\
구독 OAuth 만 있는 배포에서는 부서 에이전트를 파일 서버로 쓰지 않는다.

**조용히 지나가지 않게 하는 장치.** 위 조합이 설정에 남아 있으면 `openclaw doctor` 가 경고한다.\
검사 id 는 `codex/agent-workspace-boundary` 이고, 읽기 전용 + 워크스페이스 한정으로 선언된 에이전트가\
codex 런타임으로 라우팅될 때만 뜬다(`extensions/codex/src/doctor-workspace-boundary.ts`).

```bash
docker compose --env-file chris-local/ixauth.env -f chris-local/docker-compose.ixauth.yml \
  exec -u node gateway node openclaw.mjs doctor --lint --only codex/agent-workspace-boundary
```

## 14. 텔레그램 운영 규칙

부서 경계는 브라우저로 들어오는 사람에게만 성립한다. 텔레그램은 그 밖이라 운영 규칙으로 지킨다.

### 14.1 부서당 봇 계정과 에이전트를 분리한다

봇 하나에 여러 부서 에이전트를 물리지 않는다. 부서 하나 = 봇 계정 하나 = 에이전트 하나다.\
그렇게 해야 "이 방에서 오는 질문은 이 폴더만 본다" 가 채널 수준에서 성립한다.\
한 봇이 여러 에이전트를 고르게 하면, 고르는 주체가 사람이 아니라 모델이 되어 경계가 사라진다.

### 14.2 allowlist 와 계정 비활성은 별개 통제다

| 통제                     | 무엇을 정하는가                   | 어디서 끄는가    |
| ------------------------ | --------------------------------- | ---------------- |
| 텔레그램 allowlist       | 누가 이 봇에게 말을 걸 수 있는가  | 채널 설정        |
| IX-Auth 계정 비활성·삭제 | 누가 웹 화면에 로그인할 수 있는가 | 사용자 관리 화면 |

**둘은 서로를 모른다.** 사람이 나가면 두 곳을 다 처리해야 한다.\
계정만 비활성화하고 allowlist 에 남겨 두면 그 사람은 텔레그램으로 계속 답을 받는다.\
allowlist 에서만 빼고 계정을 남겨 두면 웹으로 계속 들어온다.

### 14.3 발신자와 계정을 잇는 장치는 없다

텔레그램 발신자 id 를 IX-Auth 프로필에 연결하는 코드는 현재 없다.\
따라서 텔레그램으로 온 질문에는 **역할 상한도 부서 경계도 적용되지 않고**, 그 봇에 물린 에이전트의\
워크스페이스가 곧 허용 범위다. 이것이 14.1 을 규칙이 아니라 사실상 유일한 통제로 만든다.\
발신자-계정 연결은 후속 과제다([DELIVERY-PLAN.md](DELIVERY-PLAN.md) 1절 "채팅" 행).
