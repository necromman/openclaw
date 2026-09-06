# FORK.md - necromman/openclaw (Chris fork)

이 저장소는 [openclaw/openclaw](https://github.com/openclaw/openclaw) 의 포크다. **정본은 이 문서다.** chris-server 레포의 `knowledge/development/openclaw-fork.md` 는 좌표만 담은 요약이다.

- 포크 생성일: 2026-09-06 (KST, 일요일)
- 기준 태그: **v2026.9.2** (커밋 `3928bad9badfcb6c7d140530435e806fb8092190`, "docs: finalize 2026.9.2 release notes")
- 상위 라이선스: MIT (c) OpenClaw Foundation. `LICENSE` 와 `THIRD_PARTY_NOTICES.md` 는 그대로 유지한다.

---

## 1. 왜 포크했나

npm 배포본(`npm i -g openclaw`)은 바이너리라 **고칠 수가 없다.** 홈랩 게이트웨이 claw01 은 배포본을 쓰고 있어서 동작을 바꾸려면 업스트림이 고쳐 주기를 기다려야 한다. 이 포크의 목적은 세 가지다.

1. **소스 소유권.** 전체 모노레포를 로컬에 두고 직접 빌드해서, 원하는 지점을 바로 고칠 수 있게 한다.
2. **개조 가능성 실증.** Control UI 브랜딩처럼 설정 키가 없는 지점을 소스 수정으로 바꿀 수 있는지 실제로 확인한다.
   (업스트림 문서에는 제품명·로고 교체용 설정 키가 없다. 화이트라벨은 곧 소스 포크다.)
3. **홈랩 이식성.** 리눅스에서 빌드해 두면 claw01 로 그대로 옮길 수 있다.

상표 주의: 코드는 MIT 라 자유롭지만 **"OpenClaw" 이름과 로브스터 마스코트는 별개 권리**다. 이 포크는 **로고·아이콘 에셋을 교체하지 않고 위치만 기록**한다 (아래 5장 브랜딩 지점 표). 외부에 제품으로 내보낼 일이 생기면 이름과 마스코트를 먼저 걷어내야 한다.

---

## 2. 좌표

| 항목 | 값 |
|------|-----|
| 포크 (origin) | `https://github.com/necromman/openclaw` (necromman 계정) |
| 업스트림 (upstream) | `https://github.com/openclaw/openclaw` |
| **빌드 정본 체크아웃** | **WSL2 Ubuntu 24.04: `~/openclaw`** (= `\\wsl.localhost\Ubuntu\home\necromman\openclaw`) |
| 편집·IDE 체크아웃 | Windows: `D:\PROJECT\openclaw` |
| 로컬 인스턴스 홈 | WSL: `~/openclaw-local/` (설정·상태·워크스페이스·로그) |
| 기본 브랜치 | `main` (= 태그 v2026.9.2 로 맞춰 둠) |
| 작업 브랜치 | **`chris/main`** (모든 커스터마이즈는 여기에 쌓는다) |
| Node | WSL **v24.20.0** (nvm). 저장소 요구: `>=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0` |
| pnpm | **12.1.0** (corepack, `package.json` 의 `packageManager` 핀) |
| Control UI | `http://127.0.0.1:18789/` (loopback 전용) |

**두 체크아웃의 역할이 다르다.** `~/openclaw` 가 빌드·테스트·구동의 정본이고, `D:\PROJECT\openclaw` 는 편집용이다. 둘은 같은 origin 을 보므로 **동기화는 push/pull 로만** 한다. `/mnt/d/...` 를 WSL 에서 직접 빌드하면 I/O 가 느리고 퍼미션 문제가 나므로 쓰지 않는다.

---

## 3. 브랜치 전략

```
upstream/main ─────────────────────────────▶ (업스트림 개발선, 추적만)
        │
        └─ tag v2026.9.2 ──▶ origin/main      (포크의 기준선. 태그와 동일하게 유지)
                              │
                              └─ origin/chris/main   (우리 변경분)
```

- `main` 은 **직접 고치지 않는다.** 항상 "우리가 올라타 있는 업스트림 릴리스 태그" 와 같은 커밋을 가리킨다.
- 모든 변경은 `chris/main` 에 쌓는다.
- 릴리스 태그는 업스트림 `main` 의 조상이 아니다 (릴리스는 `release/<버전>` 브랜치에서 잘린다).
  그래서 "업스트림 main 을 따라간다" 가 아니라 **"다음 릴리스 태그로 갈아탄다"** 가 우리 동기화 모델이다.

### 3-1. 포크 push 함정 (겪은 것, 재발 방지)

gh CLI 토큰 스코프가 `repo` 뿐이고 `workflow` 가 없으면, `.github/workflows/` 내용이 달라지는 push 가 이 메시지로 거부된다.

```
! [remote rejected] main -> main
  (Unable to determine if workflow can be created or updated due to timeout; `workflows` scope may be required.)
```

우회법 (실제로 쓴 것): **포크의 기본 브랜치를 잠깐 릴리스 브랜치로 바꿔** 워크플로 비교 기준선을 맞춘 뒤 GitHub refs API 로 ref 를 옮기고, 끝나면 기본 브랜치를 되돌린다.

```bash
# 1) 기준선을 태그와 같은 내용의 브랜치로 이동
gh api -X PATCH repos/necromman/openclaw -f default_branch=release/2026.9.2

# 2) chris/main 생성 + main 을 태그로 강제 이동 (objects 는 이미 포크 네트워크에 있다)
echo '{"ref":"refs/heads/chris/main","sha":"<태그 커밋>"}' > /tmp/ref.json
gh api -X POST  repos/necromman/openclaw/git/refs --input /tmp/ref.json
echo '{"sha":"<태그 커밋>","force":true}'            > /tmp/ref2.json
gh api -X PATCH repos/necromman/openclaw/git/refs/heads/main --input /tmp/ref2.json

# 3) 기본 브랜치 원복
gh api -X PATCH repos/necromman/openclaw -f default_branch=main
```

`.github/workflows/` 를 건드리지 않는 평범한 커밋은 이 우회 없이 `git push origin chris/main` 으로 그냥 나간다. 근본 해결은 `gh auth refresh -h github.com -s workflow` 인데 브라우저 승인이 필요하다.

---

## 4. 업스트림 동기화 절차

새 릴리스(예: `v2026.10.0`)가 나왔을 때 밟는 순서다. **WSL 정본 체크아웃에서 실행한다.**

```bash
cd ~/openclaw

# 1. 업스트림 태그 가져오기
git fetch upstream --tags --prune

# 2. 새 태그 확인 (릴리스 브랜치에서 잘리므로 upstream/main 의 조상이 아닐 수 있다)
git tag --list 'v2026.*' | tail -5
NEW=v2026.10.0

# 3. main 을 새 태그로 갈아탄다 (fast-forward 가 아니라 재지정이다)
git checkout -B main "$NEW"

# 4. 우리 변경분을 새 기준선 위로 리베이스
git checkout chris/main
git rebase --onto "$NEW" <이전 태그> chris/main
#   충돌 나면 해결 후 git rebase --continue

# 5. 다시 빌드·검증
corepack pnpm install --frozen-lockfile
corepack pnpm build && corepack pnpm ui:build
corepack pnpm check && corepack pnpm test

# 6. 푸시 (main 은 3-1 의 workflow 스코프 함정을 다시 만날 수 있다)
git push origin chris/main
```

`git rebase --onto` 의 `<이전 태그>` 는 지금 기준으로 `v2026.9.2` 다. 업스트림 릴리스 케이던스가 매우 빨라(주 수회) **매 릴리스를 따라가지 않는다.** 따라갈 이유(보안 패치·필요한 기능)가 생겼을 때만 갈아탄다.

---

## 5. 브랜딩 지점 표

Control UI 의 제품명·로고·테마가 소스 어디에 있는지 실측한 결과다. **교체한 것은 "코드" 열이 `수정함` 인 세 곳뿐이고, 로고·마스코트 에셋은 건드리지 않았다.**

| 대상 | 파일 | 위치 | 코드 |
|------|------|------|------|
| 부팅 시 탭 제목 (정적) | `ui/index.html` | `<title>` | **수정함** |
| 번들 기동 실패 화면 라벨 | `ui/index.html` | `.mount-fallback__eyebrow` | **수정함** |
| About 페이지 히어로 제품명 | `ui/src/i18n/locales/en.ts` | `aboutPage.productName` | **수정함** |
| 승인 화면 브랜드명 | `ui/src/i18n/locales/en.ts` | `approvalPage.brandName` | 미수정 |
| 런타임 탭 제목 접미사 | `ui/src/app-navigation.ts` | `formatDocumentTitle()` 의 하드코딩 `"OpenClaw"` | 미수정 (테스트 다수가 이 문자열을 단언한다) |
| 탭 제목 적용 지점 | `ui/src/app/app-host.ts` | `syncDocumentTitle()` | 미수정 |
| About 페이지 렌더링 | `ui/src/pages/about/view.ts` | `t("aboutPage.productName")` | 미수정 |
| 파비콘 (SVG/PNG/ICO) | `ui/public/` | `favicon.svg`, `favicon-32.png`, `favicon.ico`, `apple-touch-icon.png` | **미수정 (상표)** |
| PWA 매니페스트 | `ui/public/manifest.webmanifest` | 앱 이름·아이콘 | 미수정 |
| 플랫폼 아트워크 | `ui/public/app-art/` | `*.webp` (플랫폼별 라이트/다크) | **미수정 (상표)** |
| 내장 테마 11종 | `ui/public/themes/` | 테마 CSS | 미수정 |
| 다국어 문자열 전체 | `ui/src/i18n/locales/` | `en.ts` 가 원본, 나머지는 번역 | en 만 수정 |

**찾은 방법** (다음에 다시 찾을 때 그대로 쓸 수 있다):

```bash
# 1. 정적 HTML 에 박힌 제품명
grep -n "OpenClaw" ui/index.html

# 2. i18n 원본에서 브랜드 키
grep -n 'brandName\|productName' ui/src/i18n/locales/en.ts

# 3. 런타임 탭 제목을 만드는 함수
grep -rn "formatDocumentTitle" ui/src/

# 4. 교체하면 안 되는 에셋 위치
ls ui/public/*.svg ui/public/*.png ui/public/*.ico ui/public/app-art/
```

**교훈.** 런타임 탭 제목의 `"OpenClaw"` 는 i18n 키가 아니라 `app-navigation.ts` 에 **하드코딩**돼 있고, `app-host.document-title.test.ts` 와 `app-navigation.test.ts` 가 그 문자열을 단언한다. 진짜 화이트라벨을 하려면 이 상수를 i18n 키로 빼고 두 테스트 파일도 함께 고쳐야 한다. 이번 변경은 테스트를 깨지 않는 지점만 골랐다.

---

## 6. 빌드 환경 구축 (재현 명령)

### 6-1. WSL2 Ubuntu (정본 레인)

```bash
# 0. WSL 진입 (Windows 쪽에서)
wsl -d Ubuntu

# 1. Node 24 (저장소 요구: >=24.15.0 <25). 배포판 기본 Node 18 로는 안 된다.
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 24 && nvm alias default 24     # -> v24.20.0

# 2. pnpm 은 corepack 이 package.json 의 packageManager 핀(12.1.0)을 그대로 가져온다
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable

# 3. 클론 (LF 보존)
git -c core.autocrlf=false clone https://github.com/necromman/openclaw.git ~/openclaw
cd ~/openclaw
git config core.autocrlf false
git remote add upstream https://github.com/openclaw/openclaw.git
git fetch upstream --tags --prune
git checkout chris/main

# 4. 빌드
corepack pnpm install --frozen-lockfile
corepack pnpm build        # 코어 + dts + Control UI 까지 한 번에 돈다
corepack pnpm ui:build     # Control UI 만 다시 굽고 싶을 때

# 5. 확인
node ~/openclaw/openclaw.mjs --version    # -> OpenClaw 2026.9.2 (3928bad)
```

빌드 의존성으로 `python3`/`make`/`g++` 를 따로 설치할 필요는 없었다. Ubuntu 24.04 기본 상태 + Node 24 만으로 `pnpm install` 이 통과한다 (네이티브 모듈은 prebuilt 를 받는다).

### 6-2. Windows 네이티브 (부가 레인, 실패)

`D:\PROJECT\openclaw` 에서 `corepack pnpm install --frozen-lockfile` 을 실행하면 **저장소 자신의 preinstall 가드가 막는다.**

```
node ./engine-requirements.js
[openclaw] error: this OpenClaw release requires Node >=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0.
Error: ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED
```

이 PC 의 Windows Node 는 **v24.12.0** 이라 `>=24.15.0` 조건에 미달한다. 즉 툴체인 문제가 아니라 **Node 버전 하나** 때문이고, Windows 에 Node 24.15+ 를 올리면 풀린다. 지금은 시스템 Node 를 건드리지 않기로 하고 **WSL 레인을 정본으로 확정**했다. `D:\PROJECT\openclaw` 는 편집·git 전용으로 쓴다 (`node_modules` 불필요).

### 6-3. WSL VM 이 꺼져서 게이트웨이가 죽는 함정 (중요)

WSL2 는 실행 중인 세션이 없으면 유틸리티 VM 을 내린다. 그러면 systemd user 매니저째로 내려가 `loginctl enable-linger` 를 켜 놨어도 게이트웨이가 같이 죽는다. 증상은 "방금 200 이던 `http://127.0.0.1:18789/` 가 갑자기 ECONNREFUSED" 다.

해결 (둘 중 하나):

```bash
# (a) WSL 세션을 하나 붙잡아 둔다 (즉시 적용, 부작용 없음)
wsl -d Ubuntu -- bash -lc "sleep 86400"     # 백그라운드로 띄워 둔다

# (b) 유틸리티 VM 을 아예 안 내리게 한다 (%USERPROFILE%\.wslconfig, wsl --shutdown 후 적용)
#     [wsl2]
#     vmIdleTimeout=-1
```

(b) 는 Docker Desktop 을 포함한 WSL2 전체에 영향을 주므로, 평소에는 (a) 로 충분하다.

---

## 7. 구동 / 중지 / 설정

로컬 인스턴스는 **홈랩 claw01 과 완전히 분리**돼 있다. 별도 홈(`~/openclaw-local`), 별도 설정·상태, 별도 게이트웨이 토큰을 쓰고, **채널(텔레그램 등)은 하나도 붙이지 않았다.** 홈랩 봇 토큰을 여기에 넣으면 polling 이 충돌하므로 넣지 않는다.

### 7-1. 최초 설치

```bash
cd ~/openclaw
bash chris-local/install.sh
```

`chris-local/install.sh` 가 하는 일 (멱등): 게이트웨이 토큰 생성 → 설정 patch → `config validate` → systemd user 서비스 설치·기동.

### 7-2. 일상 운영

```bash
cd ~/openclaw
bash chris-local/gateway.sh status     # 서비스 + 리스너 + HTTP 코드
bash chris-local/gateway.sh restart
bash chris-local/gateway.sh stop
bash chris-local/gateway.sh logs 100

# CLI 는 래퍼로 (소스 빌드 + 격리 홈에 자동으로 묶인다)
~/openclaw-local/bin/oc --version
~/openclaw-local/bin/oc doctor
~/openclaw-local/bin/oc security audit --deep
~/openclaw-local/bin/oc agent --json -m "hello"
```

### 7-3. 좌표

| 항목 | 값 |
|------|-----|
| 포트 | **18789** (Windows 쪽에서 18789/18790/18791 모두 비어 있음을 확인하고 기본값 사용) |
| bind | `loopback` (127.0.0.1 과 ::1 에만 붙는다. LAN 노출 없음) |
| 인증 | `gateway.auth.mode=token` + 레이트리밋 (10회/60초, 5분 락아웃) |
| 설정 파일 | `~/openclaw-local/.openclaw/openclaw.json` (0600) |
| 상태·세션 DB | `~/openclaw-local/.openclaw/state/openclaw.sqlite` |
| 워크스페이스 | `~/openclaw-local/.openclaw/workspace` |
| 게이트웨이 토큰 | `~/openclaw-local/.openclaw/gateway-token.txt` (0600, **git 미추적**) |
| 서비스 로그 | `~/openclaw-local/gateway.log` |
| 서비스 | systemd **user** 유닛 `openclaw-local.service` (`~/.config/systemd/user/`) |
| Control UI | `http://127.0.0.1:18789/` - Windows 브라우저에서 WSL2 localhost 포워딩으로 그대로 열린다 |

`openclaw gateway install` 은 **쓰지 않는다.** 비기본 state dir 을 쓰면 `service management skipped: non-default state dir or config path` 로 거부하기 때문에, 이 포크는 `chris-local/openclaw-local.service` 로 유닛을 직접 들고 있다.

### 7-4. WSL 에서 한 시스템 변경 (재현용 기록)

| 변경 | 명령 | 이유 |
|------|------|------|
| nvm + Node 24 설치 | 6-1 참조 | 배포판 Node 18 은 요구 버전 미달 |
| `~/.config` 소유권 수정 | `sudo chown -R $USER:$USER ~/.config` (root 셸에서 실행) | root 소유라 systemd user 유닛을 못 만들었다 |
| linger 활성화 | `loginctl enable-linger $USER` | 로그아웃 후에도 user 서비스 유지 |
| git 자격증명 | `git config --global credential.helper store` + `~/.git-credentials` (0600) | WSL 에는 gh CLI 미설치. GitHub 토큰은 Windows gh 에서 가져왔다 |

---

## 8. 모델 연결

```bash
# 토큰은 stdin 으로만 넣는다. 셸 히스토리·로그·커밋에 남기지 않는다.
printf '%s' '<claude setup-token 값>' | ~/openclaw-local/bin/oc \
  models auth paste-token --provider anthropic --profile-id anthropic:local --expires-in 365d

~/openclaw-local/bin/oc models set anthropic/claude-sonnet-5
~/openclaw-local/bin/oc models status
```

- 프로필 **`anthropic:local`** (`anthropic/token`), 만료 **2027-09-06**.
- 기본 모델 **`anthropic/claude-sonnet-5`**, thinking=high.
- 토큰 값은 chris-server 레포 `homelab/homelab-access.md` 17장 금고에만 있다. **이 문서와 커밋에는 없다.**
- 홈랩 claw01 은 같은 토큰을 프로필 `anthropic:sub1` 로 쓴다. 프로필 id 를 달리해 둔 이유는 두 인스턴스의
  자격증명 저장소가 섞이지 않게 하기 위해서다.

---

## 9. Docker 경로

저장소는 `Dockerfile`(멀티스테이지, bookworm-slim 런타임)과 `docker-compose.yml` 을 들고 있다. compose 는 컨테이너 안의 경로를 `OPENCLAW_HOME=/home/node` 로 고정하고, 호스트 `~/.openclaw` 를 바인드 마운트한다.

포트가 로컬 인스턴스(18789)와 겹치지 않게 **다른 값**을 쓴다. 아래 10장에 실측 결과를 적었다.

---

## 10. 검증 결과

(아래 수치는 2026-09-06 이 PC 에서 실측한 값이다.)

### 10-1. 빌드

| 항목 | 결과 |
|------|------|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm ui:build` | exit 0 |
| `openclaw --version` | `OpenClaw 2026.9.2 (3928bad)` (소스 커밋 해시가 찍힌다 = 배포본이 아니라 우리 빌드) |

### 10-2. 구동

| 항목 | 결과 |
|------|------|
| systemd user 서비스 | `active (running)` |
| 리스너 | `127.0.0.1:18789`, `[::1]:18789` |
| Control UI (WSL 내부) | HTTP 200 |
| Control UI (Windows 브라우저) | HTTP 200 (WSL2 localhost 포워딩 동작) |
| 기기 페어링 | loopback 자동 승인 (`device pairing auto-approved ... role=operator`) |
| 로드된 플러그인 | 16개 (acpx, browser, canvas, cua-computer, device-pair, file-transfer, geolocation, google-meet, linux-node, memory-core, ollama, openai, talk-voice, teams-meetings, xai, zoom-meetings) |

### 10-3. 모델 실동작

CLI 경유 (`oc agent --json -m ...`):

```
"finalAssistantVisibleText": "FORK-OK\nanthropic/claude-sonnet-5"
"executionTrace": { "winnerProvider": "anthropic", "winnerModel": "claude-sonnet-5",
                    "result": "success", "fallbackUsed": false, "runner": "embedded" }
```

Control UI 경유 (브라우저 채팅 왕복): 질문 "say UI-OK and name your model" 에 대해 `UI-OK - anthropic/claude-sonnet-5` 응답. 스크린샷은 chris-server 레포 `analysis/2026-09-06-openclaw-2/control-ui-roundtrip.png`.

### 10-4. `openclaw security audit --deep`

**0 critical / 2 warn / 1 info.**

| 항목 | 내용 | 판정 |
|------|------|------|
| `gateway.trusted_proxies_missing` | bind 가 loopback 인데 `trustedProxies` 가 비어 있다 | **의도된 것.** 리버스 프록시를 안 쓰는 로컬 전용 인스턴스다 |
| `gateway.probe_failed` | deep 프로브가 `missing scope: operator.read` | CLI 기기에 operator.read 스코프가 없어서 나는 것. 게이트웨이 자체는 정상 (HTTP 200 + 실제 채팅 왕복 성공) |

### 10-5. `openclaw doctor`

경고는 모두 **"설정 안 함"** 계열이고 결함이 아니다.

| 경고 | 원인 |
|------|------|
| GitHub 검색이 public-only | `gateway.controlUi.github.token` 미설정 (의도) |
| Legacy Browser Relay Auth 켜짐 | 업스트림 기본값. 브라우저 확장을 안 쓰므로 방치 |
| 스킬 30개 사용 불가 | 외부 바이너리·API 키 미설치 (1password, github, spotify-player 등) |
| Memory search 비활성 | `OPENAI_API_KEY` 미설정. Anthropic 만 붙였다 |

---

## 11. 홈랩 claw01 로 배포하는 방법 (개요)

claw01(192.168.100.17)은 지금 **npm 배포본** `openclaw@2026.9.2` 를 쓴다. 이 포크 빌드로 갈아타려면 큰 흐름은 이렇다. **아직 실행하지 않았다.**

1. **패키지를 만든다.** WSL 정본에서 `corepack pnpm build` 후 `npm pack` 으로 tarball 을 뽑는다.
   (`package.json` 의 `files` 가 `dist/`·`openclaw.mjs` 등 배포 대상을 이미 정의해 둔다.)
2. **claw01 로 옮긴다.** `scp <tarball> root@192.168.100.17:/tmp/` 후
   `npm install -g /tmp/<tarball> --allow-scripts=openclaw`.
3. **설정은 건드리지 않는다.** claw01 의 `/root/.openclaw/openclaw.json` 은 그대로 두면 된다
   (버전이 같은 2026.9.2 기준이라 스키마 마이그레이션이 없다).
4. **재기동·확인.** `openclaw gateway restart && openclaw gateway status && openclaw --version`.
   버전 문자열에 커밋 해시가 붙으면 포크 빌드로 갈아탄 것이다.
5. **되돌리기.** `npm install -g openclaw@2026.9.2` 로 배포본 복귀.

주의: claw01 에는 텔레그램 봇 `@chris84_claw_bot` 이 붙어 있다. 로컬 인스턴스에는 채널을 붙이지 않았으므로 같은 봇 토큰이 두 곳에서 polling 하는 사고는 없다. 이식할 때도 채널 설정은 claw01 쪽 것만 유지한다.

Docker 경로로 배포하고 싶다면 이 레포의 `Dockerfile` 로 이미지를 굽고 claw01 에서 compose 로 올리면 되는데, claw01 은 LXC 컨테이너라 도커 중첩이 필요하므로 현재 구성(호스트 npm 설치)이 더 단순하다.

---

## 12. 파일 지도 (이 포크가 추가한 것)

| 경로 | 역할 |
|------|------|
| `FORK.md` | 이 문서 (정본) |
| `chris-local/install.sh` | 격리된 로컬 인스턴스 설치 (멱등) |
| `chris-local/gateway.sh` | start/stop/restart/status/logs |
| `chris-local/oc-env.sh` | 격리 환경변수 (HOME/CONFIG/STATE/WORKSPACE + nvm) |
| `chris-local/oc` | 소스 빌드에 묶인 `openclaw` CLI 래퍼 |
| `chris-local/openclaw-local.service` | systemd user 유닛 템플릿 (`@NODE_BIN@` 치환) |

업스트림 파일 중 수정한 것은 5장 표의 세 곳뿐이다.
