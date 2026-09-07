# DELIVERY-PLAN.md - 진바이오테크 납품 기능 계획 (D~I 단계)

> 2026-09-07 제안서(`진바이오테크-제안서-20260907.docx`)와 사용자 지시(로그인 = 기기 자동 인증, 로그아웃, 관리자의 사용자 관리, 관리자·임원·직원 구분, PDF·MS Office 미리보기, hwp 제외)를 현재 포크와 대조해 남은 작업을 단계로 나눈 정본이다.\
> 앞선 A·B·C 단계 기록은 [AUTH-PLAN.md](AUTH-PLAN.md) 끝의 "A·B·C 진행 기록", 인수인계는 [HANDOFF.md](HANDOFF.md).

작성 2026-09-07 (KST). 기준 커밋 `chris/main@3959ade8bb6`.

---

## 0. 실측으로 확인한 것 (2026-09-07 20:30~21:10)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 로그인 후 기기 자동 인증 | **이미 동작.** compose 스택(18800) 새 브라우저 컨텍스트에서 로그인 즉시 `/chat/main` 진입, 게이트웨이 로그 `[ws] authenticated user connected user=admin@deploy.local`, 페어링 요청·기기 토큰 미생성 | `src/gateway/server/ws-connection/connect-policy.ts:39-46` (`identity-session`), 지역성 조건 없음 |
| 로그아웃 | BFF `POST /auth/logout` 은 있음. **UI 신원 메뉴에 항목 없음.** 서버는 열린 WS 를 끊지 않고 화면 리로드에 의존 | `src/gateway/ix-auth-http.ts:327-372`, `ui/src/features/ix-auth/ix-auth-session-api.ts:251-260` |
| 관리자 사용자 관리 | 앱 안에는 초대 발급·가입 승인·부서 조회만(설정 > 연결). 목록·삭제·역할 변경은 `/admin/identity/` 로 중계되는 IX-Auth 콘솔인데 **별도 로그인 화면이 한 번 더 뜬다** | `ui/src/pages/connection/ix-auth-invite-section.ts`, IX-Auth `UserAdminController` (목록·상세·생성·PATCH·삭제·password-reset·invite·unlock·mfa-reset·roles·sessions 전부 있음) |
| 역할 | superadmin / admin / moderator / member 4단계. **임원 없음.** UI 는 역할 코드를 날것으로 표시 | `src/auth/ix-auth/ix-auth-role-map.ts:13-50` |
| 문서 미리보기 | 로컬 WSL 은 soffice 있음. **납품 컨테이너에 soffice 없음** → PDF 정상, docx·xlsx 는 이미지 없는 HTML 폴백, pptx·doc·xls·ppt 는 실패. 안내문 영어뿐 | `chris-local/docker-compose.ixauth.yml:110` (폰트만), `src/gateway/document-convert.ts:110-121` |
| 납품 스택 모델 | "사용 가능한 모델 없음". DEPLOY.md 에 모델·API 키 항목 없음 | 라이브 화면, `chris-local/DEPLOY.md` |
| 기본 에이전트 미지정 | `cron.list` → "Agent-less cron job has no resolvable owner", `talk.catalog` → `AGENT_SELECTION_REQUIRED` | 게이트웨이 로그 20:36:07 |

## 1. 제안서 요구 대비 현황

| 제안서 요구 (장) | 현재 | 결손 | 단계 |
| --- | --- | --- | --- |
| 웹 화면, 사내 주소 접속 (3) | 완료 | - | - |
| 채팅(카카오톡·텔레그램처럼) (3) | 텔레그램 확장 있음. 카카오톡 확장 없음 | 텔레그램 발신자와 IX-Auth 계정 연결 장치 없음. 부서 경계는 에이전트 바인딩으로만 적용 | 문서화(I), 연결은 후속 |
| 자료 찾기·근거 인용 (2·3·6) | `memory.search.extraPaths` 로 워크스페이스 밖 폴더 인덱스 가능, 인용 `path#L12-L30` 지원 | **인덱서가 `.md` 만 수집.** pdf·docx·xlsx·pptx 는 인덱스 대상이 아님. 한글 FTS 토크나이저 기본값 부적합 | **I** (대), D(설정) |
| 문서 초안·요약 (3) | 에이전트 기본 능력 | - | - |
| 반복 확인·알림 (3) | cron 5종 + 텔레그램 전달 + 타임존 | 생성자 정보가 공개 응답에서 제거됨(관리자가 누가 만든 스케줄인지 못 봄) | G(소) |
| 읽기 전용 원칙 (3) | 세션 `permissionMode: read-only` 와 도구 deny 목록으로 가능 | **config 로 "이 에이전트는 항상 읽기 전용" 선언 불가.** `readonly` 도구 프로필 없음. `tools.fs.workspaceOnly` 기본 false | **G** (중) |
| 폴더 단위 접근 범위 (4) | 에이전트 1개 = 워크스페이스 루트 1개 | 다중 폴더 허용목록 없음. 부서 = 에이전트 = 폴더 구조로 대응 | G(문서·설정), allowRoots 는 후속 |
| 사람마다 다른 자료 범위 (4) | 부서 경계(B 단계) + 역할 상한 | **임원 역할 없음** | **E** |
| 누가 무엇을 물었고 어떤 자료를 봤는지 기록 (4) | `audit_events` 는 메타데이터 전용. actor 가 사람이 아님. 질문 본문·파일 경로·로그인 미기록. 30일/10만행 고정 | **AUTH-PLAN M4 전량 미착수** | **H** (대) |
| 외부 접속 개폐 (4) | bind 5모드 + `controlUi.enabled` + 단일 포트 | - (DEPLOY.md 7절) | - |
| NAS 안 모델 (4·5) | ollama 등 6종, 임베딩까지 사내 완결 | DEPLOY.md 에 모델 설정 절차 없음 | D(문서) |
| 로그인 = 기기 인증 (지시) | 완료 | 로그아웃 시 서버측 WS 종료 없음 | D |
| 로그아웃 (지시) | API 만 | 메뉴 항목 | **D** |
| 관리자 사용자 관리 (지시) | IX-Auth 콘솔(이중 로그인) | 앱 내 화면 | **F** |
| 관리자·임원·직원 (지시) | 4역할, 임원 없음 | 임원 역할 + 한국어 역할명 | **E** |
| PDF·MS Office 미리보기 (지시) | 로컬만 완전 | 납품 이미지에 soffice 없음, 안내문 영어 | **D** |

## 2. 감독이 정한 기본값 (사용자가 뒤집을 수 있음)

| 항목 | 채택 | 이유 · 대안 |
| --- | --- | --- |
| 임원 역할 구현 방식 | IX-Auth `EXECUTIVE` → 게이트웨이 `executive`. 세션 타인 열람 상한 `view`, 스코프는 member 와 같음. **전 부서 열람은 부서 경계 코드를 고치지 않고 IX-Auth 에서 전 `dept-*` 그룹에 소속시켜 얻는다.** 초대 화면에서 역할이 임원이면 부서를 전체 선택으로 기본 채운다 | 부서 경계에 "전 부서 읽기 전용" 상태를 새로 넣으면 약 36개 파일 재설계·횡단 유출 위험(캐시 키). "부서는 상한을 넓히지 않고 좁히기만 한다" 원칙을 그대로 쓰는 편이 안전하다. 대안: 후속 단계에서 `crossDepartmentViewRoles` 별도 키 |
| 역할 한국어 표기 | superadmin 시스템 관리자 / admin 관리자 / executive 임원 / moderator 중재자 / member 직원 | 초대·사용자 관리 화면의 선택지는 직원·임원·관리자 3개(+ 시스템 관리자는 superadmin 만). moderator 는 설정 호환용으로 남기되 선택지에서 뺀다 |
| 관리자가 임원을 초대할 수 있는가 | 가능 | admin 은 자기 부서만 보지만 사용자 관리는 admin 의 책무. 다만 superadmin 승격은 기존대로 차단 |
| 로그아웃 | 신원 메뉴 항목 + 계정 화면 버튼. 서버는 `/auth/logout` 에서 그 프로필의 열린 WS 를 끊는다 | 클라이언트 리로드 의존 제거 |
| 사용자 관리 화면 위치 | 신원 메뉴 "사용자 관리" → `/settings/users` (superadmin·admin 만 링크·라우트) | 라우트 추가 비용은 있으나 설정 페이지 안의 블록으로는 목록·상세를 담기 어렵다. IX-Auth 콘솔 링크는 superadmin 에게만 "고급" 으로 남긴다 |
| 미리보기 변환기 | compose 빌드 인자에 `libreoffice-writer libreoffice-calc libreoffice-impress fonts-nanum` 추가 | 이미지 약 +580MiB. FILE-PREVIEW.md 예시와 일치시킨다. hwp 는 범위 밖(사용자 확정) |
| 읽기 전용 | `readonly` 도구 프로필 신설 + `agents.entries.<id>.tools.permissionMode` 기본값 키. 납품 config 는 `tools.fs.workspaceOnly: true` | deny 목록 수작업은 신규 도구 추가 시 누락 위험 |
| 감사 원장 범위 | 사람 귀속 원장 `audit_user_activity`: 로그인·로그아웃, 질문 본문(설정으로 on), 도구 파일 읽기 경로, 관리자 행위(초대·역할 변경·삭제), 세션 열람. 보존기간 설정 키. 조회 API·CLI·관리자 화면. **해시 체인은 넣지 않는다**(외부 SIEM 정본 권고 유지) | AUTH-PLAN M4 의 축소판. 계약서에 "내장 원장은 보존기간 내 조회용" 명시 |
| 문서 인덱싱 | 게이트웨이 안에 변환 단계를 두지 않고, **`openclaw knowledge sync` CLI + cron** 이 NAS 폴더의 pdf·docx·xlsx·pptx 를 `.md` 사이드카(원본 경로·수정시각 frontmatter)로 뽑아 인덱스 폴더에 쓴다. `extraPaths` 는 그 폴더를 가리킨다 | 인덱서(`memory-host-sdk`)를 건드리면 업스트림 리베이스 비용이 크다. 기존 `document-convert.ts`·`document-extract-html.ts`·`clawpdf` 재사용 |
| 텔레그램 | 부서당 봇 계정·에이전트 분리를 운영 규칙으로 문서화. 발신자-계정 연결은 후속 | 코드 전수 확인 결과 연결 장치 없음 |

## 3. 단계

작업 규칙은 FORK.md 그대로: 브랜치 하나에 에이전트 하나, 게이트 `pnpm check` 0 실패 → 라이브 실측 → `origin/chris/main` 리베이스 → ff 머지 → 자동 배포 확인 → 브랜치 삭제. 빌드·테스트는 WSL `~/openclaw` 에서 브랜치를 체크아웃해 돌린다.

### D 단계 - 로그아웃·미리보기 변환기·납품 설정 기본값 (소)

브랜치 `chris/delivery-d`.

1. 신원 메뉴(사이드바 하단 사용자 메뉴)에 "로그아웃" 항목. ix-auth 모드에서만 렌더. 계정 화면에도 버튼. 완료 후 로그인 화면으로.
2. `/auth/logout` 처리에서 `disconnectClientsForUserProfile(profileId)` 호출 → 열린 WS 종료. 테스트 추가.
3. `docker-compose.ixauth.yml` 빌드 인자에 LibreOffice 3종 + `fonts-nanum`. 이미지 재빌드 후 docx·xlsx·pptx 미리보기 실측.
4. `documentPreview.*` 문구 한국어 7개(`ko` 로케일).
5. 납품 config(`ixauth-gateway-config/openclaw.json`): `tools.fs.workspaceOnly: true`, `memory.citations: "on"`, `memory.search.store.fts.tokenizer: "trigram"`, `agents.defaults.systemAgent.agentId`, `talk.agentId` → `cron.list`·`talk.catalog` 오류 제거.
6. DEPLOY.md: 모델 프로바이더 설정 절(외부 API 키 `.env` 자리표시자, ollama 사내 모델 절차), 재색인 절차(`openclaw memory index --force`), 미리보기 변환기 항목.
7. FILE-PREVIEW.md 와 compose 동기화 기록.

### E 단계 - 임원 역할 (중)

브랜치 `chris/delivery-e`.

1. `ix-auth-role-map.ts`: `EXECUTIVE: "executive"`, 정렬 admin 다음. 콘솔 역할 목록은 불변.
2. IX-Auth 마이그레이션 `V15__openclaw_executive_role.sql` 3방언 신규(V14 수정 금지). `build.gradle.kts` 버전 접미 `+openclaw.3`.
3. 배포 config·검증 스크립트 `roles.definitions.executive` (`sessions.others: "view"`, member 스코프).
4. 초대 표면: `IX_AUTH_INVITABLE_ROLE_CODES` 에 EXECUTIVE. 부서 다중 지정 지원(임원 기본 전체).
5. UI: 역할 한국어 표기 카탈로그 `ko-ix-auth.ts` 신설·등록, 초대 선택지 직원·임원·관리자(+시스템 관리자 조건부).
6. 테스트: `ix-auth-role-map.test.ts` 5역할, `department-access.test.ts` 는 executive 를 매트릭스에 넣지 않고 별도 describe(전 부서 그룹 소속 → 각 부서 open, 타인 세션 view 상한).
7. 라이브: 임원 계정 1명 초대 → 두 부서 세션 열람 가능·쓰기 불가 실측.
8. 문서: AUTH-IXAUTH.md 5절, AUTH-DEPARTMENTS.md 3절, DEPLOY.md 역할 표, `ix-auth/MODULE.md` 델타 표.

### F 단계 - 앱 내 사용자 관리 (중)

브랜치 `chris/delivery-f`.

1. BFF `/auth/admin/users` 계열: 목록(검색·페이지), 상세, 생성(=초대), 수정(이름·상태·부서), 역할 변경, 삭제(비활성 우선, 삭제는 superadmin), 비밀번호 재설정 링크, 초대 재발송, 잠금 해제, 세션 강제 종료. 인가는 세션 + superadmin·admin + CSRF, superadmin 승격·강등은 superadmin 만. 모든 행위를 감사 이벤트로 남길 훅 지점을 표시(H 단계에서 연결).
2. UI `/settings/users`: 목록·검색·상세 패널·역할/부서 변경·상태 토글·행위 버튼. 기존 초대·승인 블록을 이 화면으로 이동.
3. 신원 메뉴에 "사용자 관리"(superadmin·admin). IX-Auth 콘솔 링크는 superadmin 전용 "고급".
4. 테스트: BFF 표면 인가 매트릭스, UI 컴포넌트.
5. 라이브: 관리자 로그인 → 사용자 생성·역할 변경·비활성·재활성·삭제 실측. 이중 로그인 없음 확인.
6. 문서: AUTH-SIGNUP.md 5·6절 갱신 또는 `AUTH-USERS.md` 신설.

### G 단계 - 읽기 전용 프로필·폴더 범위·스케줄 생성자 (중)

브랜치 `chris/delivery-g`.

1. `readonly` 도구 프로필(`tool-catalog.ts`): read·memory_search·memory_get·web 조회류만. 신규 도구는 기본 제외.
2. `agents.entries.<id>.tools.permissionMode` 기본값 키(스키마·타입·세션 생성 시 적용). 세션이 이를 넘어 올리려면 ADMIN 스코프.
3. cron 공개 뷰에 생성자(프로필 id·이메일) 투영.
4. 납품 config 예시: 부서 에이전트 = NAS 부서 폴더 워크스페이스 + `readonly` + `workspaceOnly`. 인사·급여 폴더는 어느 에이전트에도 안 붙임.
5. 문서: `AUTH-DEPARTMENTS.md` 에 "폴더 단위 접근은 에이전트 워크스페이스로" 절, 텔레그램 운영 규칙(부서당 봇·에이전트).

### H 단계 - 사람 귀속 감사 원장 (대)

브랜치 `chris/delivery-h`.

1. 스키마 `audit_user_activity`(id, at, profile_id, email, role, departments, session_key, agent_id, kind, detail_json, ip, ua). kind: login·logout·prompt·tool_read·session_view·admin_action·file_download.
2. 기록 지점: `/auth/login`·`/auth/logout`, chat.send(본문은 `logging.audit.userActivity.promptText: true` 일 때), 도구 read·memory_get·sessions_files 열람(경로), 세션 열람(history 조회), F 단계 관리자 행위.
3. 보존 `logging.audit.userActivity.retentionDays`(기본 90) + 행 상한. 야간 정리.
4. 조회: RPC `audit.userActivity.list`(superadmin·admin, admin 은 자기 부서), CLI `openclaw audit users`, UI `/settings/audit` 필터(사람·기간·kind)·CSV 내보내기.
5. 테스트: 기록 지점별, 부서 필터, 보존 정리.
6. 문서: `AUTH-AUDIT.md` 신설(한계: 내장 원장은 조회용, SIEM 정본 권고).

### I 단계 - NAS 문서 → 마크다운 인덱스 (대)

브랜치 `chris/delivery-i`.

1. CLI `openclaw knowledge sync --source <dir> --out <dir> [--include ...]`: pdf(clawpdf 텍스트), docx·xlsx(`document-extract-html` → 텍스트), pptx(soffice → pdf → 텍스트). 산출 `.md` 에 frontmatter(원본 경로·크기·mtime·해시). 변경분만 재변환, 삭제 원본은 사이드카 제거.
2. cron 예시(`every 30m`)와 compose 볼륨 예시(NAS 마운트 읽기 전용).
3. 인용이 사이드카 경로를 가리키므로 frontmatter 의 원본 경로를 답변에 함께 내도록 `memory_search` 결과 장식 확인(가능하면 원본 경로로 치환).
4. 라이브: 샘플 폴더(pdf·docx·xlsx·pptx 각 1) → 검색 질의 → 출처 포함 답변 실측(한글).
5. 문서: `KNOWLEDGE.md` 신설(운영 절차·재색인·한계: hwp 제외).

## 4. 사용자 결정 대기 (변경 없음)

IX-Auth UNLICENSED 법무, 고객 SMTP·도메인·TLS·약관, 부서 기밀 계약 문구(셀 분리), 감사 보존기간 확정(기본 90일), 제품명, 카카오톡 채널 필요 여부(제안서는 "카카오톡이나 텔레그램처럼" 이라 텔레그램으로 충족한다고 가정).

## 5. 진행 기록

| 단계 | 상태 | 브랜치 | 머지 커밋 | 비고 |
| --- | --- | --- | --- | --- |
| D | 진행 중 | `chris/delivery-d` | - | 2026-09-07 21:10 착수 |
| E | 대기 | | | |
| F | 대기 | | | |
| G | 대기 | | | |
| H | 대기 | | | |
| I | 대기 | | | |
