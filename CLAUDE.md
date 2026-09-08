# CLAUDE.md - 이 저장소에서 작업할 때 먼저 읽는 것

업스트림 규칙은 [AGENTS.md](AGENTS.md) 를 그대로 따른다. 아래는 이 포크(chris fork)에만 있는 맥락이다.\
다른 PC 에서 이 저장소만 클론해도 이어갈 수 있도록 여기에 필요한 것을 다 적는다.

## 1. 이 저장소는 무엇인가

- OpenClaw v2026.9.2 의 개인 포크 `necromman/openclaw`. 작업 정본 브랜치 `chris/main`, 업스트림 기준 브랜치 `main`(태그와 동일하게 유지). 동기화 절차와 포크 규칙은 [FORK.md](FORK.md).
- 납품 목표: 진바이오테크(한 회사·여러 부서)용 사내 AI 비서. 인증은 회사 제품 IX-Auth 를 `ix-auth/` 에 복제한 모듈로 붙였다.
- 정본 문서는 전부 `chris-local/` 에 있다.

| 문서 | 내용 |
| --- | --- |
| [chris-local/HANDOFF.md](chris-local/HANDOFF.md) | 인수인계(좌표·들어간 것·기본값·보류·시작 절차·함정). **새 세션은 이것부터** |
| [chris-local/DELIVERY-PLAN.md](chris-local/DELIVERY-PLAN.md) | 납품 기능 계획 D~J 단계, 제안서 대비 현황, 진행 기록, 사용자 결정 대기 |
| [chris-local/CODEBASE.md](chris-local/CODEBASE.md) | 코드 구조 지도 |
| [chris-local/AUTH-IXAUTH.md](chris-local/AUTH-IXAUTH.md) 외 `AUTH-*.md` | 로그인·역할·부서·초대·사용자 관리·감사 원장 정본 |
| [chris-local/DEPLOY.md](chris-local/DEPLOY.md) | 납품형 compose 스택 설치·설정·모델·NAS 마운트·사내망 배치 |
| [chris-local/FILE-PREVIEW.md](chris-local/FILE-PREVIEW.md), [KNOWLEDGE.md](chris-local/KNOWLEDGE.md) | 문서 미리보기, NAS 문서 색인 |
| [.claude/PROMPT.md](.claude/PROMPT.md) | 세션 주입용 요약(이 파일과 같은 내용의 짧은 판) |

## 2. 실행 환경 (PC 마다 다르다)

- 이 포크는 **Node 24.15 이상**을 요구한다(내장 SQLite 3.51.3 가드). 그 아래 Node 에서는 빌드·vitest 가 시작조차 안 된다.
- 원래 작업 PC(윈도우)는 Windows 체크아웃을 편집·커밋용으로만 쓰고, 빌드·테스트는 WSL Ubuntu `~/openclaw`(같은 origin, Node 24.20) 에서 한다. 푸시하면 WSL 의 2분 타이머가 `chris/main` 을 pull → 빌드 → 재시작한다.
- 납품형 스택은 `chris-local/docker-compose.ixauth.yml`(gateway + IX-Auth jar + PostgreSQL 16 + mailpit). 로컬 주소 `http://127.0.0.1:18800`, 개발용 메일함 `http://127.0.0.1:18025`. 자격증명·시크릿은 `chris-local/ixauth.env`(git 제외)에 두고 `ixauth.env.example` 을 복사해 만든다.
- 다른 PC 에서 처음 시작할 때: Node 24.15 이상 + `corepack pnpm install` → `pnpm check` 가 0 실패인지 확인 → compose 스택은 `chris-local/DEPLOY.md` 3절대로 기동.

## 3. 인프라·서버·시크릿 정보 (이 저장소에 없다)

- 홈랩·회사 서버·납품처 NAS 접속 정보와 시크릿은 **별도 비공개 저장소 `chris-server`** 에 있다(원래 PC 경로 `D:\PROJECT\chris-server`, 인덱스는 그 저장소의 `CLAUDE.md`). 이 포크는 GitHub 에 올라가고 납품본이 될 수 있어 여기에 넣지 않는다.
- 원래 PC 에는 사본이 `chris-local/infra/local/`(git 제외)에 있다. 안내는 [chris-local/infra/README.md](chris-local/infra/README.md).
- **chris-server 가 없는 PC 에서는** 코드·문서·compose 스택 작업은 전부 가능하고, 홈랩·NAS 실측만 불가하다. 실측이 필요하면 chris-server 를 같은 상위 폴더에 클론하거나 사본을 `chris-local/infra/local/` 에 놓는다.

## 4. 작업 규칙 (요약, 상세는 FORK.md)

- 브랜치 하나에 에이전트 하나. 단계별 브랜치 `chris/delivery-<단계>` 에서 작업하고 `chris/main` 에 ff 머지. 워크트리 명령은 쓰지 않는다.
- 게이트: `pnpm check` 0 실패 → 라이브 실측(스크린샷) → `origin/chris/main` 리베이스 → ff 머지 → 자동 배포 확인 → 브랜치 삭제.
- 업스트림 파일 수정 최소화. 새 파일은 `chris-local/`·`src/brand.ts`·`ui/src/styles/fork-style.css`·ix-auth 계층에. 저장소 규칙(700줄 상한·env 이름 래칫·UI 청크 215KiB gz·시작 번들 예산)은 `pnpm check` 가 강제한다.
- 브랜딩: 표시 문자열에 "OpenClaw" 금지, 제품명은 `src/brand.ts` 상수(임시 "Chris Agent"). 내부 식별자·LICENSE 는 유지.
- 스타일: 상세페이지 full width(채팅 제외), border-radius 2/4/5px 상한.
- 문서·문자열에 U+2014·U+00A7·U+3161 을 쓰지 않는다. 시크릿 값은 어디에도 커밋하지 않는다.
- 커밋 메시지는 한국어 요약. 진행 기록은 `chris-local/DELIVERY-PLAN.md` 5절에 남긴다.

## 5. 현재 상태 (2026-09-08 기준)

- 머지 완료: 브랜딩 제거, 스타일 공통화, 문서 미리보기(PDF·Office), 브라우저 도구, IX-Auth 로그인(= 기기 자동 인증)·로그아웃, 역할 5단계(시스템 관리자·관리자·임원·중재자·직원), 부서 경계, 초대·가입, 앱 내 사용자 관리, 읽기 전용 프로필·NAS 마운트 배선, 사람 귀속 감사 원장.
- 진행 중·예정: I 단계(NAS 문서 → 마크다운 색인), J 단계(관리자 WS 권한 결함, 사용자 표 full width, IX-Auth 콘솔 SSO, 부서·폴더 관리 화면, 시드 정리).
- 사용자 결정 대기: 부서 에이전트용 API 키(ChatGPT 구독 codex 경로로는 폴더 경계를 지키며 읽을 수 없음), 감사 보존기간·질문 본문 기록, 제품명, IX-Auth 라이선스, SMTP·도메인·TLS. 상세는 DELIVERY-PLAN.md 4절.
