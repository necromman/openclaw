# 세션 진행 맥락 (포크 D:\PROJECT\openclaw)

## 이 저장소는 무엇인가
- OpenClaw v2026.9.2 의 개인 포크(`necromman/openclaw`). 작업 정본 브랜치 `chris/main`, 업스트림 기준 브랜치 `main`. 업스트림 동기화 절차와 포크 규칙은 `chris-local/FORK.md`.
- 납품 목표: 진바이오테크(한 회사·여러 부서)용 사내 에이전트. 인증은 회사 제품 IX-Auth 를 `ix-auth/` 에 복제한 모듈로 붙였다(`chris-local/AUTH-IXAUTH.md`).
- **인수인계 정본: `chris-local/HANDOFF.md`** (좌표·들어간 것·기본값·보류·시작 절차·함정). 새 세션은 이것부터 읽는다.

## 실행 환경
- 빌드·실행 정본은 WSL Ubuntu `~/openclaw`(같은 origin). 이 Windows 체크아웃은 편집·커밋용. 푸시하면 2분 타이머가 WSL 에서 pull → 빌드 → 재시작. 즉시 반영 `wsl -d Ubuntu -- bash -lc '~/openclaw/chris-local/auto-deploy.sh --now'`.
- 로컬 인스턴스 `http://127.0.0.1:18789`(token 모드) / 납품형 compose `http://127.0.0.1:18800`(ix-auth 모드, Docker Desktop, `chris-local/docker-compose.ixauth.yml`).
- Windows 네이티브 빌드는 Node 24.15 이상 요구로 불가(이 PC 24.12). 빌드·테스트는 WSL 에서.

## 작업 규칙 (요약, 상세는 FORK.md)
- 브랜치 하나에 에이전트 하나. 브랜치 전환 전 `git status`. 워크트리 명령 금지(이 PC 정책).
- 게이트: `pnpm check` 0 실패 → 라이브 실측(스크린샷) → `origin/chris/main` 리베이스 → ff 머지 → 자동 배포 확인 → 브랜치 삭제.
- 업스트림 파일 수정 최소화, 새 파일은 `chris-local/`·`src/brand.ts`·`ui/src/styles/fork-style.css` 계층에. 저장소 규칙(700줄 상한·env 이름 래칫·번들 상한 215KiB gz)은 `pnpm check` 가 강제한다.
- 브랜딩: 표시 문자열에 "OpenClaw" 금지, 제품명은 `src/brand.ts` 의 상수(임시 "Chris Agent"). 내부 식별자·LICENSE 는 유지.
- 스타일: 상세페이지 full width(채팅 제외), border-radius 2/4/5px 상한, "줄이기만·0 은 0".
- 금지 문자 U+2014·U+00A7·U+3161. 홈랩 서버(192.168.100.x)는 이 저장소 작업에서 접근하지 않는다.

## 현재 상태 (2026-09-07)
- 완료·머지: 브랜딩 제거, 스타일 공통화, 문서 미리보기(PDF/docx/xlsx/pptx), 브라우저 도구, IX-Auth 로그인(BFF·세션·JWKS·페어링 면제·역할 매핑), 배포 패키징(compose), 부서 강제(`dept-<slug>`, 404 은닉), 초대·가입(SMTP 유무 분기).
- 사용자 결정 대기: 제품명, IX-Auth UNLICENSED 법무, 고객 SMTP·약관, 부서 기밀 계약 문구(셀 분리 여부), 감사 보존기간, 인제스트 앱 A/B.
- 다음 구현 후보: TOTP 등록 화면, 한국어 외 로케일 19개, 선재 결함 2건(`chat.history` 가시성 필터·시작 번들 예산), 이메일 열거 타이밍(IX-Auth 측), hwp 미리보기, 브랜딩 잔여(마스코트·앱 아트·네이티브 아이콘).
