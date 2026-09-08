# OpenClaw 작업 인수인계 (2026-09-06 ~ 09-07)

> 다음 세션이 이 문서 하나로 이어받도록 쓴 것이다. 상세는 각 정본 링크를 따라간다. 시간은 전부 KST.

## 0. 30초 요약

- 홈랩에 OpenClaw 2.0 운영 인스턴스(claw01)를 세우고, GitHub 포크(`necromman/openclaw`)를 이 윈도우북 WSL 에서 소스 빌드로 돌리며, 포크에 브랜딩 제거·UI 개선·문서 미리보기·브라우저·**회사 IX-Auth 기반 로그인·역할·부서·초대**까지 넣었다.
- 납품 대상은 진바이오테크(한 회사·여러 부서). 외부 IdP 대신 회사 제품 IX-Auth 를 포크 안에 복제해 모듈로 쓴다.
- 코드·문서는 전부 머지·커밋됐고, 남은 것은 사용자·법무 결정 항목과 선재 결함 2건이다.

> **인프라 정보 규칙**: 홈랩·회사 서버·접속 정보·시크릿 위치가 필요하면 `D:\PROJECT\chris-server\CLAUDE.md`(인덱스) → 그 정본 문서를 참조한다. 이 포크 저장소에는 인프라 정보와 시크릿을 두지 않는다.

## 0-1. 2026-09-08 갱신 (D~J 단계 완료)

- 제안서·사용자 지시 기반 납품 기능 D~J 7단계가 **전부 `chris/main` 에 머지·푸시**됐다(마지막 커밋 `983afae343e`). 단계별 내용·실측·잔여는 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 5절 진행 기록이 정본이고, 이 절은 다음 세션이 바로 움직일 수 있는 최소 요약이다.
- 들어간 것: 로그아웃(WS 즉시 종료) · 납품 이미지 LibreOffice(Office 미리보기) · 임원 역할·다중 부서 초대 · 앱 내 사용자 관리 `/settings/users` · 읽기 전용 프로필·권한 모드·NAS 마운트(경로 A) · 사람 귀속 감사 원장 `/settings/audit` · `openclaw knowledge sync` 문서 색인 · 관리자 권한 결함 수정(로그인 시 역할 투영) · IX-Auth 콘솔 SSO(superadmin 전용) · 부서·에이전트·폴더 관리 `/settings/departments` · 시드 정리 `reset-seed.sh` · 자립형 `CLAUDE.md`.
- **라이브 상태(이 PC)**: compose 스택 4컨테이너 기동 중, 게이트웨이 이미지는 J 코드 기준. 모델은 ChatGPT 구독 codex OAuth 프로필(상태 볼륨에 저장, 템플릿에 codex 런타임·기본 모델 `openai/gpt-5.6-sol` 고정). `chris-local/ixauth.env` 에 `OPENCLAW_NAS_ROOT=./nas-sample`, `OPENCLAW_KNOWLEDGE_ROOT=./knowledge-index` 가 켜져 있고 rnd 색인 폴더에 사이드카 8개가 생성돼 있다. 관리자 권한 수정은 **재로그인 후** 반영된다(`user_profiles.role` 은 로그인 때 투영).
- **다음 세션 첫 할 일**:
  1. 사용자 결정 받기: 부서 에이전트용 API 키(OpenAI/Anthropic; codex 경로로는 폴더 경계를 지키며 읽을 수 없음, AUTH-DEPARTMENTS.md 13.9), 감사 보존기간·`promptText`, 시드 계정 8개 삭제 여부, 제품명, IX-Auth 라이선스, SMTP·도메인·TLS.
  2. API 키가 오면 `rnd-bot`·`qa-bot` 모델을 그 키 모델로 바꾸고 "폴더 문서 요약 → 출처 경로" 와 쓰기 거부·타 부서 거부를 브라우저로 실측(DELIVERY-PLAN 3-1절·KNOWLEDGE.md).
  3. K 단계(`chris/delivery-k`, 검토 대기)가 J 잔여를 전부 마감했다: 부서 삭제, 표시 이름 통일(감사 표), 콘솔 로그아웃 404, 사용자 표 다듬기(역할 "미지정"·중재자 필터), xlsx 날짜 서식, 권한 칩 라벨, 감사 세션 열. 시작 번들 예산은 **`pnpm check` 가 돌리지 않는 검사**라 실패가 아니고 기준선을 건드리지 않았다(강제는 `pnpm ui:check-performance` 뿐, 기준선 350377 B < 고정 상한 358400 B). 상세는 DELIVERY-PLAN 5절 K 행.
  4. 브라우저 실측 후 스크린샷을 chris-server `analysis/2026-09-07-openclaw-auth/` 에 `delivery-*-*.png` 로 보관(D·E·F 는 있음, G~J 는 curl·DB 실측만 있고 스크린샷 없음).
- **이번에 배운 함정(재발 방지)**: Windows 에서 vitest·pnpm check 를 돌리면 `ui/vitest.config.ts` 가 Chrome 을 실행해 화면에 창이 뜬다 → WSL 전용. chrome-devtools MCP 의 `isolatedContext` 는 호출마다 새 창을 만든다 → 확인 즉시 닫기. `CLAUDE.md` 가 심볼릭 링크(120000)로 커밋되면 리눅스 체크아웃이 깨진다 → 일반 파일 유지. 컨테이너 안 `openclaw` CLI 는 ix-auth 모드에서 게이트웨이 RPC 가 unauthorized 라 `audit users`·`knowledge sync` 처럼 로컬 경로가 있는 명령만 된다. codex 하네스는 컨테이너에서 bwrap 사용자 네임스페이스가 막혀 셸을 못 쓰고, 열면 읽기 루트가 `/` 다. `start-gateway.sh` 가 매 기동마다 템플릿으로 `openclaw.json` 을 덮어쓰므로 `doctor --fix` 결과는 템플릿에 넣어야 남는다. 같은 체크아웃을 두 에이전트가 쓰면 안 되고, 단계마다 브랜치 하나·opus 에이전트 하나.

## 1. 좌표

| 대상                  | 위치                                                                                                      | 비고                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 홈랩 운영 인스턴스    | CT 113 `claw01` 192.168.100.17, 외부 `https://claw.botops.cloud`, 내부 `https://claw.lab.botops.cloud`    | npm 배포본 2026.9.2, token 모드, 텔레그램 @chris84_claw_bot. 정본 `homelab/openclaw/README.md`, 계층 정리 `homelab/openclaw/ARCHITECTURE.md`(+html)           |
| 포크 저장소           | `https://github.com/necromman/openclaw`, 브랜치 `chris/main`(작업 정본), `main`(태그 v2026.9.2 기준)      | 업스트림 동기화 절차는 포크 `FORK.md`                                                                                                                         |
| Windows 편집 체크아웃 | `D:\PROJECT\openclaw`                                                                                     | 편집·커밋·푸시용. 브랜치 전환 전 `git status` 필수                                                                                                            |
| WSL 빌드·실행 정본    | Ubuntu `~/openclaw`, systemd user `openclaw-local.service`, `http://127.0.0.1:18789`(token 모드)          | 푸시하면 2분 타이머 `openclaw-auto-deploy.timer` 가 pull → 빌드 → 재시작. 즉시 반영 `wsl -d Ubuntu -- bash -lc '~/openclaw/chris-local/auto-deploy.sh --now'` |
| 납품형 compose 스택   | `chris-local/docker-compose.ixauth.yml`, `http://127.0.0.1:18800`(ix-auth 모드)                           | Docker Desktop(Windows) 에서 실행 중. gateway + IX-Auth jar + PostgreSQL 16 + mailpit                                                                         |
| IX-Auth 원본 / 복제   | 원본 `D:\PROJECT\ix-auth`(손대지 않음, da66bda) / 복제 `D:\PROJECT\openclaw\ix-auth\`(자유 수정 모듈)     | 경계 `ix-auth/MODULE.md`, 재동기화 `ix-auth/VENDOR.md`                                                                                                        |
| 시크릿                | `homelab/homelab-access.md` 절 17(claw01 root 비번·게이트웨이 토큰·Claude setup-token·봇 토큰·deploy key) | 로컬 포크 토큰은 WSL `~/openclaw-local/.openclaw/openclaw.json`                                                                                               |

## 2. 포크에 들어간 것 (chris/main 기준, 시간순)

| 영역              | 정본 문서(포크 `chris-local/`)                                           | 요점                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 포크·자동 배포    | `FORK.md`, chris-server `knowledge/development/openclaw-fork.md`         | WSL Node 24.20/pnpm 12.1, Docker 이미지 `openclaw-chris:local`, WSL 유휴 종료는 작업 스케줄러 keepalive 로 해결(`.wslconfig` 만으론 부족)                                                                                        |
| 코드베이스 지도   | `CODEBASE.md`(+html)                                                     | 백엔드 `src/`(node:http + ws), 프런트 `ui/`(Lit 3 + Vite 8), DB SQLite 전용(`node:sqlite`), 확장 `extensions/` 153개                                                                                                             |
| 브랜딩 제거       | `BRANDING-AUDIT.md`, `src/brand.ts`                                      | 표시 문자열 약 2,290건·이미지 6건 교체. 제품명 임시 **"Chris Agent"**, 이 파일 한 곳만 바꾸면 전체 반영. 내부 식별자·LICENSE 는 유지                                                                                             |
| 스타일 공통화     | `FORK.md` 5-A, `ui/src/styles/fork-style.css`                            | 상세페이지 full width(채팅 제외, 39 라우트 검증), radius 2/4/5px 상한, "줄이기만·0 은 0" 규칙, 컨트롤 높이 토큰                                                                                                                  |
| 숨긴 기능         | `FORK.md` 5-B, `BRAND_FEATURES.appsPage=false`                           | 앱 다운로드 메뉴·`/apps` 비노출(리다이렉트)                                                                                                                                                                                      |
| 문서 미리보기     | `FILE-PREVIEW.md`                                                        | PDF 내장 뷰어, docx/xlsx/pptx 는 LibreOffice 변환 → PDF, 한글 폰트 규칙 `workspace-pdf-rules.md`(LibreOffice 는 폰트 없어도 exit 0 이라 임베드 폰트 확인이 유일한 신호)                                                          |
| 브라우저 도구     | `BROWSER.md`                                                             | WSL 에 Google Chrome 설치, `browser.headless=true` 필수                                                                                                                                                                          |
| 인증 v2 (IX-Auth) | `AUTH-PLAN.md`(v2, 진행 기록), `AUTH-IXAUTH.md`, `AUTH-IXAUTH-OPTION.md` | 새 `gateway.auth.mode: "ix-auth"`, BFF 로그인·HttpOnly 세션·JWKS 검증·페어링 면제, 역할 매핑 SUPERADMIN/ADMIN/MODERATOR/MEMBER → superadmin/admin/moderator/member. 자체 구현안은 부록·참고 브랜치 `chris/auth-selfhosted-draft` |
| 배포 패키징       | `DEPLOY.md`                                                              | compose 무인 기동, 역할 4단계 부팅 시드, superadmin 부트스트랩, 콘솔은 BFF `/admin/identity/` 로만                                                                                                                               |
| 부서 강제         | `AUTH-DEPARTMENTS.md`                                                    | 부서 = IX-Auth 그룹 `dept-<slug>`, 세션 가시성 `department` 범위, 교차 접근 404(존재 은닉), 에이전트 선택 상한·부서 바인딩 CLI                                                                                                   |
| 초대·가입         | `AUTH-SIGNUP.md`                                                         | SMTP 있으면 APPROVAL+EMAIL, 없으면 관리자 초대 링크 72h, 비밀번호 복구, 이메일 열거 방지                                                                                                                                         |

검증 스크린샷: `analysis/2026-09-06-openclaw-2/`(브랜딩·레이아웃·미리보기·브라우저), `analysis/2026-09-07-openclaw-auth/`(ixauth 8·pack 7·dept 7·signup 8 + 검증 로그).

## 3. 홈랩 claw01 상태

- 모델: 기본 `openai/gpt-5.6-sol`(ChatGPT 구독 Codex OAuth), 예비 `anthropic/claude-sonnet-5`(1년 setup-token, 프로필 `anthropic:sub1`). 토큰 추가는 `--profile-id anthropic:sub2` + `models auth order set`.
- 지식 연동: ai01 `hl-export` → claw01 30분 pull(`knowledge/ai01/`), docs 포털 GitHub 미러 15분 pull(`knowledge/docs-portal/`), claw01 → ai01 질문 통로 `hl-ask`(읽기 전용·6회/h). 설계 `homelab/openclaw/knowledge-bridge-design.md`, ai01 측 `homelab/ai-agent/docs/knowledge-bridge.md`.
- 검색은 FTS 만 켜짐(벡터 임베딩 꺼짐). 청킹은 소스 상수(400토큰/겹침 80, 한글 약 400자).
- 텔레그램 파일 송신 함정: HTML 은 `/tmp/openclaw/` 아래여야 전송됨. 인바운드 20MB 한도.
- 새 기기 접속 = 게이트웨이 토큰 + `openclaw devices approve <요청ID>`(`--latest` 는 첫 페어링에 안 먹음).
- **하지 말 것**: ai01 의 `hl-domain rm`(Authentik 전멸 사고 이력), ai01 codex `auth.json` 복사(refresh 회전 충돌), 같은 텔레그램 봇 토큰 공유.

## 4. 감독이 정한 기본값 (사용자가 뒤집을 수 있음)

| 항목           | 채택값                                                   | 대안                                                                     |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| 제품명         | "Chris Agent"(임시)                                      | `src/brand.ts` 한 줄                                                     |
| DB             | OpenClaw SQLite 유지 + IX-Auth PostgreSQL 16             | MariaDB 가능(IX-Auth 검증됨). OpenClaw 를 Postgres 로 옮기는 것은 비권장 |
| 부서 접두사    | `dept-`                                                  | 지시는 `dept:` 였으나 콜론이 그룹 코드 검증 위험                         |
| 교차 접근 응답 | 404                                                      | 403 은 세션 존재를 노출                                                  |
| 관리 콘솔      | 외부 비노출, 게이트웨이 프록시로 admin 이상만            | 직접 노출                                                                |
| 초대           | 72시간, 수락 즉시 활성                                   | 승인 단계 추가                                                           |
| 설정 키 추가   | `gateway.auth.ixAuth.selfSignup` 1개(문서화 근거로 통과) | 제거 시 가입 모드 표시 불가                                              |
| 세션 가시성    | ix-auth 모드 기본 `self`, 부서 도입 후 `department`      | `all` 은 금지                                                            |

## 5. 보류 · 미해결

사용자·법무 결정:

1. IX-Auth 저장소 `UNLICENSED` - 납품 재배포 조건 법무 확인
2. 고객 SMTP 자격증명·발신 도메인·TLS 도메인, 약관 문안
3. 부서 간 기밀이 계약 문구에 들어가는지(들어가면 부서별 게이트웨이 셀, +3주)
4. 감사 로그 보존기간(현재 내장 90일 가정, 외부 SIEM 정본 권고)

구현 잔여: 5. TOTP 등록 화면, 한국어 외 19개 로케일(`pnpm ui:i18n:sync` 워크플로) 6. 선재 결함: `chat.history` 일반 가시성 필터 부재, 시작 번들 예산 초과(업스트림 상태) 7. 이메일 열거 타이밍 차(247ms 대 110ms) - IX-Auth 쪽 변경 필요 8. hwp 미리보기(인제스트 파이프라인 범위), xlsx 시트 상호작용, 채팅 첨부 카드 미리보기 9. 브랜딩 잔여: 기본 꺼짐 마스코트 스프라이트·갤러리·앱 아트 18개·네이티브 앱 아이콘 10. claw01 벡터 임베딩 켜기 + RAG 벤치, ai01 → claw01 역방향 통로, 텔레그램 인바운드 파일 실측 1회

설계만 있고 미착수: 11. 인제스트 앱(`knowledge/development/document-ingest-pipeline.md`, 아키텍처 A/B 선택 대기)

## 6. 새 세션 시작 절차

1. 이 문서 → `knowledge/development/openclaw-fork.md` → 포크 `chris-local/AUTH-PLAN.md` 진행 기록 순으로 읽는다.
2. 상태 실측 3줄: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/`(200), `docker ps | grep ixauth`(4개 healthy), `wsl -d Ubuntu -- bash -lc 'cd ~/openclaw && git log --oneline -1 && systemctl --user is-active openclaw-local.service openclaw-auto-deploy.timer'`.
3. 포크 작업은 브랜치 하나에 에이전트 하나. 같은 체크아웃을 두 에이전트가 동시에 쓰면 커밋이 섞인다(이번에 두 번 발생). 워크트리 명령은 이 PC 정책상 금지.
4. 게이트: `pnpm check` 0 실패 → 라이브 실측 스크린샷 → `origin/chris/main` 리베이스 → ff 머지 → 자동 배포 확인 → 브랜치 삭제.
5. chris-server 쪽은 스크린샷·문서만 두고 autosync 가 커밋한다. 포크 커밋은 자유.

## 7. 이번 작업에서 배운 함정 (재발 방지)

- 단위 테스트 통과 후 라이브에서만 드러난 결함이 15건(비루프백 바인드 가드가 ix-auth 를 "인증 없음" 판정, 페어링 면제가 루프백에만, 타 부서 전사 HTTP 200 등). 라이브 게이트를 빼면 안 된다.
- WSL2 유휴 종료는 `.wslconfig vmIdleTimeout=-1` 만으론 부족. 작업 스케줄러 `OpenClawWSLKeepalive` 가 해법.
- OpenClaw 파일 모드 드리프트가 `git pull --ff-only` 를 막은 적 있음(240e0fb 로 수정).
- 번들 상한(최대 청크 215KiB gz)이 SheetJS 류 클라이언트 라이브러리를 원천 차단. 서버 변환으로 우회.
- `openclaw models auth login` 은 TTY 필수 → `script -q -f -c` 로 pseudo-TTY. 이후 `openclaw doctor --fix` 로 codex 런타임 활성 + 재시작이 한 세트.
- Debian 12 LXC 에는 dbus 가 없어 `openclaw gateway install` 이 실패한다.
