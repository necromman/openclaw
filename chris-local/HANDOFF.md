# OpenClaw 작업 인수인계 (2026-09-06 ~ 09-07)

> 다음 세션이 이 문서 하나로 이어받도록 쓴 것이다. 상세는 각 정본 링크를 따라간다. 시간은 전부 KST.

## 0. 30초 요약

- 홈랩에 OpenClaw 2.0 운영 인스턴스(claw01)를 세우고, GitHub 포크(`necromman/openclaw`)를 이 윈도우북 WSL 에서 소스 빌드로 돌리며, 포크에 브랜딩 제거·UI 개선·문서 미리보기·브라우저·**회사 IX-Auth 기반 로그인·역할·부서·초대**까지 넣었다.
- 납품 대상은 진바이오테크(한 회사·여러 부서). 외부 IdP 대신 회사 제품 IX-Auth 를 포크 안에 복제해 모듈로 쓴다.
- 코드·문서는 전부 머지·커밋됐고, 남은 것은 사용자·법무 결정 항목과 선재 결함 2건이다.

> **인프라 정보 규칙**: 홈랩·회사 서버·접속 정보·시크릿 위치가 필요하면 `D:\PROJECT\chris-server\CLAUDE.md`(인덱스) → 그 정본 문서를 참조한다. 이 포크 저장소에는 인프라 정보와 시크릿을 두지 않는다.

## 0-1. 2026-09-08 갱신 (D~N 단계 완료)

- 제안서·사용자 지시 기반 납품 기능 D~L 9단계가 **전부 `chris/main` 에 머지·푸시**됐다(마지막 머지 커밋 `299496394bc`, L 단계 ff 머지 2026-09-08 17:44). 단계별 내용·실측·잔여는 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 5절 진행 기록이 정본이고, 이 절은 다음 세션이 바로 움직일 수 있는 최소 요약이다.
- 들어간 것: 로그아웃(WS 즉시 종료) · 납품 이미지 LibreOffice(Office 미리보기) · 임원 역할·다중 부서 초대 · 앱 내 사용자 관리 `/settings/users` · 읽기 전용 프로필·권한 모드·NAS 마운트(경로 A) · 사람 귀속 감사 원장 `/settings/audit` · `openclaw knowledge sync` 문서 색인 · 관리자 권한 결함 수정(로그인 시 역할 투영) · IX-Auth 콘솔 SSO(superadmin 전용) · 부서·에이전트·폴더 관리 `/settings/departments` · 시드 정리 `reset-seed.sh` · 자립형 `CLAUDE.md` · **L 단계**: Cloudflare Tunnel 프로파일(`--profile tunnel`, `jinbio.botops.cloud`) · `OPENCLAW_TRUSTED_PROXIES` 신설(Cloudflare 뒤에서 `__Host-`·`Secure` 쿠키 복귀) · 모델 API 키를 게이트웨이 컨테이너로 전달(신원 서버에 붙어 있었다) · 자동 배포가 pull 전에 빌드 산출물을 되돌린다 · 시작 번들 기준선 352955 B 로 갱신 · 사용자 결정 9건 문서 반영(DELIVERY-PLAN 4절 표).
- **라이브 상태(이 PC)**: compose 스택 4컨테이너 기동 중, 게이트웨이 이미지는 K 코드 기준(`fdc3b837012`). WSL 로컬 게이트웨이도 같은 커밋으로 자동 배포됐다. 모델은 ChatGPT 구독 codex OAuth 프로필(상태 볼륨에 저장, 템플릿에 codex 런타임·기본 모델 `openai/gpt-5.6-sol` 고정). `chris-local/ixauth.env` 에 `OPENCLAW_NAS_ROOT=./nas-sample`, `OPENCLAW_KNOWLEDGE_ROOT=./knowledge-index` 가 켜져 있고 rnd 색인 폴더에 사이드카 8개가 생성돼 있다. 관리자 권한 수정은 **재로그인 후** 반영된다(`user_profiles.role` 은 로그인 때 투영).
- **N 단계(채팅 첨부 소유권·부서 경계·재참조)**: 첨부는 미디어 id 하나로만 서빙돼서 로그인만 돼 있으면 누구나 남의 첨부를 받을 수 있었다(`assistant-media` 의 `sessionKey` 가 선택 파라미터, 인바운드 참조는 폴더 컨테인먼트를 항상 통과). 공용 DB 에 feature-local `inbound_media` 를 두어 세션·에이전트·프로필·원본명을 기록하고, `src/gateway/inbound-media-access.ts` 단일 판정이 참조 문자열 자체로 부서·소유자·세션 가시성을 검사한다(거부는 404 + 원장 `access_denied`). 올린 파일을 나중에 다시 꺼내는 도구 `media_list`·`media_read` 를 넣었고(`readonly` 프로필 포함, 문서는 색인과 같은 변환기로 텍스트 추출) 세션을 지워도 파일은 남기고 삭제 표시만 찍는다. 납품 템플릿에 `attachments.ttlHours` 는 넣지 않는다. 정본은 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 7-1 과 [FILE-PREVIEW.md](FILE-PREVIEW.md) 8절. **이 표가 생기기 전에 올라온 첨부(레거시)는 소유자가 없어 시스템 관리자만 열 수 있다** - 기존 대화의 이미지가 일반 사용자에게 404 로 보이면 그 이유다.
- **M 단계(CI/CD·NAS 배치)**: `chris/main` 푸시마다 GitHub Actions(`.github/workflows/chris-deliver-images.yml`)가 게이트웨이·ix-auth 이미지를 굽고 `ghcr.io/necromman/openclaw-gateway`·`openclaw-ix-auth` 에 민다(태그 `chris-main` + `sha-<짧은 커밋>`, 둘 다 public). 진바이오 NAS `/volume1/docker/openclaw/` 에 납품 스택을 세웠고, root cron 이 5분마다 `deploy.sh` 를 돌려 태그가 움직였을 때만 pull 하고 다시 띄운다. 절차·되돌리기·실측은 [DEPLOY.md](DEPLOY.md) 13절. 머지 커밋 `0bf73af4e12`. 자동 반영은 실물로 확인했다: 푸시 19:07 -> Actions 성공 19:18 -> cron 이 19:20:02 에 잡아 19:28:29 배포 완료.
- **납품 라이브 좌표**: `https://jinbio.botops.cloud`(Cloudflare Tunnel, HTTP 200 실측). 호스트는 진바이오 NAS 192.168.2.1(apps01 OpenVPN 경유), compose 프로젝트 `openclaw-ixauth`, 컨테이너 4개(db·ix-auth·gateway·cloudflared). 관리자는 `admin@deploy.local` 1명뿐이고 시드 계정은 없다. 자격증명과 배포 좌표는 `infra/local/jinbio-deploy.md`(git 제외).

- **다음 세션 첫 할 일**:
  1. **NAS 스택의 남은 세팅 2건.** 실제 공유 폴더 매핑(`OPENCLAW_NAS_ROOT` 가 아직 `nas-sample` 이다, DEPLOY.md 11.4)과 모델 API 키(부서 에이전트가 아직 답하지 못한다, DEPLOY.md 3.4 (라)). 둘 다 NAS 의 `ixauth.env` 를 고치고 `deploy.sh --force` 로 다시 띄우면 된다.
  2. **사용자 결정은 2026-09-08 에 전부 끝났다.** 9건의 결정값과 반영 위치는 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 4절 표가 정본이다: IX-Auth 라이선스(자사 제품이라 제약 없음), 도메인·TLS(`jinbio.botops.cloud` + Cloudflare Tunnel, PoC 단계, DEPLOY.md 11.7), SMTP(배포 후, DEPLOY.md 3.8), 약관(고객 제공), 부서 에이전트 API 키(배포 후, DEPLOY.md 3.4 (라)), 감사 보존 90일·질문 본문 미기록(기존 기본값과 동일), 시드 계정(로컬 유지·납품 시 정리, DEPLOY.md 4.1 (다)), 제품명(임시 "Chris Agent" 유지), 시작 번들 예산(기준선 갱신). 배포 시점에 값만 넣으면 되는 것은 DEPLOY.md 4.2 체크리스트에 모아 두었다.
  3. API 키가 오면 DEPLOY.md 3.4 (라) 순서대로 `rnd-bot`·`qa-bot` 모델을 그 키의 모델로 바꾸고(정본 템플릿에 적어야 남는다), "폴더 문서 요약 → 출처 경로" 와 쓰기 거부·타 부서 거부를 브라우저로 실측한다(DELIVERY-PLAN 3-1절·KNOWLEDGE.md).
  4. K 단계(`chris/delivery-k`, 머지 완료)가 J 잔여를 전부 마감했고 브라우저 실측 8개 시나리오를 통과했다: 부서 삭제, 표시 이름 통일(감사 표), 콘솔 로그아웃 404, 사용자 표 다듬기(역할 "미지정"·중재자 필터), xlsx 날짜 서식, 권한 칩 라벨, 감사·사용자 표 고정 열 폭. 시작 번들 예산은 **`pnpm check` 가 돌리지 않는 검사**라 게이트 실패가 아니어서 기준선을 건드리지 않았다. 다만 `pnpm ui:check-performance` 를 직접 돌리면 실측 352964 B 로 허용선(350953 B)을 2011 B 넘겨 실패한다. 기준선 갱신(4096 B 래칫 안, 고정 상한 358400 B 아래)과 UI 축소 중 어느 쪽을 할지는 결정 대기다. 상세는 DELIVERY-PLAN 5절 K 행.
  5. 스크린샷 증적은 chris-server `analysis/2026-09-07-openclaw-auth/` 에 `delivery-*-*.png` 로 보관돼 있다(D~K 전부 있음. G·H·J 각 1장, K 9장). 테스트 계정(member·qamem·exec1 등)의 비밀번호는 어디에도 기록돼 있지 않아 비관리자 시점 실측은 콘솔에서 비밀번호 초기화 후에만 가능하다.
- **이번에 배운 함정(재발 방지)**: Windows 에서 vitest·pnpm check 를 돌리면 `ui/vitest.config.ts` 가 Chrome 을 실행해 화면에 창이 뜬다 → WSL 전용. chrome-devtools MCP 의 `isolatedContext` 는 호출마다 새 창을 만든다 → 확인 즉시 닫기. `CLAUDE.md` 가 심볼릭 링크(120000)로 커밋되면 리눅스 체크아웃이 깨진다 → 일반 파일 유지. 컨테이너 안 `openclaw` CLI 는 ix-auth 모드에서 게이트웨이 RPC 가 unauthorized 라 `audit users`·`knowledge sync` 처럼 로컬 경로가 있는 명령만 된다. codex 하네스는 컨테이너에서 bwrap 사용자 네임스페이스가 막혀 셸을 못 쓰고, 열면 읽기 루트가 `/` 다. `start-gateway.sh` 가 매 기동마다 템플릿으로 `openclaw.json` 을 덮어쓰므로 `doctor --fix` 결과는 템플릿에 넣어야 남는다. 같은 체크아웃을 두 에이전트가 쓰면 안 되고, 단계마다 브랜치 하나·opus 에이전트 하나. **WSL 체크아웃에 미추적·수정 파일이 남으면 자동 배포의 `git pull --ff-only` 가 계속 거절돼 게이트웨이가 옛 빌드로 남는다**(2026-09-08 I 단계 잔재로 35커밋 뒤처짐). L 단계에서 `auto-deploy.sh` 가 pull 전에 빌드 산출물(`extensions/*/package.json` 의 `openclaw.assetScripts.buildOutputs` 로 선언된 파일들, 지금은 workboard 플러그인 매니페스트와 canvas 번들 3개)을 되돌리고 되돌린 이름을 로그에 남기도록 고쳤으므로, 이 원인으로는 더 막히지 않는다. 그 밖의 더러움은 여전히 FAIL 이고 이제 `git status --short` 가 로그에 함께 찍힌다. 세션 시작 실측에 `wsl ... git status -sb` 를 넣고, 잔재는 origin 과 `cmp` 로 대조한 뒤 `git stash push -u` 로 보존하고 pull 한다. 타이머는 HEAD 가 원격과 같으면 아무것도 안 하므로 손으로 pull 했으면 `auto-deploy.sh --force` 가 필요하고, `wsl -- bash -lc '... &'` 로 띄운 백그라운드는 세션 종료와 함께 죽으니 Bash 도구의 백그라운드 실행으로 포그라운드에서 돌린다. 감사·사용자 표처럼 자동 표 레이아웃에서 `td` 의 `max-width` 는 무시되므로 표를 컨테이너에 맞추려면 `table-layout: fixed` + 열별 비율이 필요하고, 비율은 자연 폭이 아니라 각 열의 가장 긴 고정 문구("시스템 관리자", 전체 지역 시각)로 잡는다.

- **M 단계 함정**: docker-compose 1.28.5(DSM 6)는 `depends_on.condition: service_healthy` 를 오래 기다리지 않고 `up` 전체를 실패시킨다. 게이트웨이 첫 기동이 1분 30초라 cloudflared 는 짧은 형식 `depends_on: [gateway]` 이어야 한다. Windows Git Bash 의 `openssl rand` 는 CRLF 를 내므로 `tr -d '
'` 로 CR 까지 지우지 않으면 env 값 안에 CR 이 남고, docker-compose 가 그 자리에서 값을 잘라 관리자 비밀번호가 짧아진 채 시드된다. DSM 6 의 `/etc/crontab` 은 칸을 탭으로 구분해야 하고 `synoservice` 는 `/usr/syno/sbin/` 에 있다. NAS 로 파일을 보낼 때는 `scp -O`(DSM 6 sshd 에 sftp 서브시스템이 없다).

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
2. 상태 실측 3줄: `curl -s -o /dev/null -w '%{http_code}' https://jinbio.botops.cloud/`(200), `gh run list --repo necromman/openclaw --limit 3`(최근 이미지 빌드 성공), NAS 에서 `sudo /volume1/docker/openclaw/deploy.sh --status`(컨테이너 4개 healthy).
3. **`chris/main` 에서 직접 작업한다**(2026-09-08 사용자 확정). 브랜치와 별도 작업 트리를 만들지 않고, 의미 단위로 커밋해 바로 푸시한다. `.claude/settings.json` 의 PreToolUse 훅이 그 명령들을 차단한다. 같은 체크아웃을 두 에이전트가 동시에 쓰지 않는 규칙은 그대로다.
4. **게이트: 푸시 → GitHub Actions 이미지 빌드 성공 → NAS cron 반영(`deploy.log` 의 OK 줄) → `https://jinbio.botops.cloud` 브라우저 실측.** WSL 의 `pnpm check`·vitest·`pnpm format` 왕복과 로컬 compose 실측은 하지 않는다. 저장소 규칙(700줄 상한·env 이름 래칫·번들 상한)은 CI 가 걸러 준다. 푸시가 곧 배포이고, 중간 상태가 운영에 반영돼도 된다는 것이 사용자 결정이다.
5. chris-server 쪽은 스크린샷·문서만 두고 autosync 가 커밋한다. 포크 커밋은 자유.

## 7. 이번 작업에서 배운 함정 (재발 방지)

- 단위 테스트 통과 후 라이브에서만 드러난 결함이 15건(비루프백 바인드 가드가 ix-auth 를 "인증 없음" 판정, 페어링 면제가 루프백에만, 타 부서 전사 HTTP 200 등). 라이브 게이트를 빼면 안 된다.
- WSL2 유휴 종료는 `.wslconfig vmIdleTimeout=-1` 만으론 부족. 작업 스케줄러 `OpenClawWSLKeepalive` 가 해법.
- OpenClaw 파일 모드 드리프트가 `git pull --ff-only` 를 막은 적 있음(240e0fb 로 수정).
- 빌드가 다시 쓰는 추적 파일(플러그인 매니페스트·벤더 번들)도 같은 방식으로 pull 을 막았다. `auto-deploy.sh` 가 pull 직전에 그것들만 되돌리고 로그에 이름을 남긴다(L 단계). 되돌리는 목록은 각 확장의 `package.json` 이 스스로 선언한다.
- 번들 상한(최대 청크 215KiB gz)이 SheetJS 류 클라이언트 라이브러리를 원천 차단. 서버 변환으로 우회.
- `openclaw models auth login` 은 TTY 필수 → `script -q -f -c` 로 pseudo-TTY. 이후 `openclaw doctor --fix` 로 codex 런타임 활성 + 재시작이 한 세트.
- Debian 12 LXC 에는 dbus 가 없어 `openclaw gateway install` 이 실패한다.
