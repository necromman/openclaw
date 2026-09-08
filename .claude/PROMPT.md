# 세션 진행 맥락 (포크 D:\PROJECT\openclaw)

## 이 저장소는 무엇인가

- OpenClaw v2026.9.2 의 개인 포크(`necromman/openclaw`). 작업 정본 브랜치 `chris/main`, 업스트림 기준 브랜치 `main`. 업스트림 동기화 절차와 포크 규칙은 `chris-local/FORK.md`.
- 납품 목표: 진바이오테크(한 회사·여러 부서)용 사내 에이전트. 인증은 회사 제품 IX-Auth 를 `ix-auth/` 에 복제한 모듈로 붙였다(`chris-local/AUTH-IXAUTH.md`).
- **인수인계 정본: `chris-local/HANDOFF.md`** (좌표·들어간 것·기본값·보류·시작 절차·함정). 새 세션은 이것부터 읽는다.

## 실행 환경

- 빌드·실행 정본은 WSL Ubuntu `~/openclaw`(같은 origin). 이 Windows 체크아웃은 편집·커밋용. 푸시하면 2분 타이머가 WSL 에서 pull → 빌드 → 재시작. 즉시 반영 `wsl -d Ubuntu -- bash -lc '~/openclaw/chris-local/auto-deploy.sh --now'`.
- 로컬 인스턴스 `http://127.0.0.1:18789`(token 모드) / 납품형 compose `http://127.0.0.1:18800`(ix-auth 모드, Docker Desktop, `chris-local/docker-compose.ixauth.yml`).
- Windows 네이티브 빌드는 Node 24.15 이상 요구로 불가(이 PC 24.12). 빌드·테스트는 WSL 에서.

## 인프라·서버 정보가 필요할 때 (규칙)

- 홈랩(Proxmox·claw01·ai01·docker01·Traefik·Cloudflare·Authentik·docs 포털)·회사 서버(IDC·GitLab·LiteLLM)·접속 정보·시크릿 위치는 **이 저장소에 없다.** 반드시 `D:\PROJECT\chris-server\CLAUDE.md` 를 먼저 읽고 그 인덱스가 가리키는 정본(`homelab/README.md`, `homelab/homelab-access.md`, `knowledge/infrastructure/server-inventory.md`, `homelab/openclaw/README.md`)을 따라간다.
- 그 저장소의 필수 지침(서버 명령은 `logs/command-log.md` 기록, 서버 설정 변경은 사용자 명시 요청 없이 금지, root 접속 규칙, Traefik 등록 방법)은 서버를 만질 때 그대로 적용한다.
- 시크릿 값은 이 포크 저장소에 절대 복사하지 않는다(환경변수·`.env` 자리표시자만).
- 납품처(진바이오테크) NAS·서버 정보의 **로컬 사본**은 `chris-local/infra/local/`(git 제외)에 있고 안내는 `chris-local/infra/README.md`. 실측 전 정본과 diff 한다.

## 작업 규칙 (요약, 상세는 FORK.md)

- 브랜치 하나에 에이전트 하나. 브랜치 전환 전 `git status`. 워크트리 명령 금지(이 PC 정책).
- 게이트: `pnpm check` 0 실패 → 라이브 실측(스크린샷) → `origin/chris/main` 리베이스 → ff 머지 → 자동 배포 확인 → 브랜치 삭제.
- 업스트림 파일 수정 최소화, 새 파일은 `chris-local/`·`src/brand.ts`·`ui/src/styles/fork-style.css` 계층에. 저장소 규칙(700줄 상한·env 이름 래칫·번들 상한 215KiB gz)은 `pnpm check` 가 강제한다.
- 브랜딩: 표시 문자열에 "OpenClaw" 금지, 제품명은 `src/brand.ts` 의 상수(임시 "Chris Agent"). 내부 식별자·LICENSE 는 유지.
- 스타일: 상세페이지 full width(채팅 제외), border-radius 2/4/5px 상한, "줄이기만·0 은 0".
- 금지 문자 U+2014·U+00A7·U+3161. 홈랩 서버(192.168.100.x)는 이 저장소 작업에서 접근하지 않는다.

## 현재 상태 (2026-09-08)

- D~J 단계 전부 머지: 로그아웃, Office 미리보기, 임원 역할, 앱 내 사용자 관리, 읽기 전용·NAS 마운트, 감사 원장, 문서 색인, 관리자 권한 결함 수정, 콘솔 SSO, 부서·폴더 관리 화면. 상세·잔여는 `chris-local/DELIVERY-PLAN.md` 5절, 요약은 `chris-local/HANDOFF.md` 0-1절.
- 사용자 결정 대기: 부서 에이전트용 API 키(codex 구독 경로로는 폴더 경계 유지 불가), 감사 보존기간·질문 본문 기록, 시드 계정 삭제, 제품명, IX-Auth 라이선스, SMTP·도메인·TLS.
- 규칙 추가: Windows 에서 vitest·pnpm check 금지(Chrome 창이 뜸), 검증은 WSL 전용. 브라우저 도구는 확인 즉시 페이지를 닫는다.
