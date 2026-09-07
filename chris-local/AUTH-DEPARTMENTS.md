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

| 역할         | 세션 타인 열람 (역할 상한) | 부서 경계          |
| ------------ | -------------------------- | ------------------ |
| `superadmin` | write                      | **없음** (전 부서) |
| `admin`      | write                      | 자기 부서          |
| `moderator`  | suggest                    | 자기 부서          |
| `member`     | view                       | 자기 부서          |

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

| 항목                                                      | 상태                                                                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.history` 의 **일반** 가시성 필터 부재               | **선재 결함.** `sessions.get` 과 달리 역할 상한 행 필터가 없다. 이번엔 부서 펜스만 넣었다 - 기존 모드의 동작을 바꾸는 변경이라 별도 심사가 필요하다 |
| 같은 부서의 다른 에이전트 간 모델 도구 열람               | 미구현. 도구 축은 보수적으로 에이전트 경계로 판정한다(4절)                                                                                          |
| `human-mention-policy` 의 생성 게이트                     | 채널 발신 경로라 검증된 IX-Auth principal 이 없다. 부서 전달 대상 아님                                                                              |
| 로컬 CLI(`agents list`·`sessions`)                        | 게이트웨이를 안 탄다. 호스트 셸 = 경계 밖(7절)                                                                                                      |
| 구버전 open/use -> 신버전 reopen 왕복 실측                | 미실시(6.1)                                                                                                                                         |
| 부서별 감사 원장                                          | 미구현. AUTH-IXAUTH 6.3 의 조건이던 6.1 이 이번에 충족됐으므로 이제 착수 가능                                                                       |
| IX-Auth `replaceRoles(null)` 이 조용히 기본 역할로 되돌림 | 벤더 트리 이슈. `MODULE.md` 경계상 포크가 고칠 수 있으나 이번 범위 밖. 운영 절차 9.2 에 경고를 남겼다                                               |
