# FORK.md - necromman/openclaw (Chris fork)

이 저장소는 [openclaw/openclaw](https://github.com/openclaw/openclaw) 의 포크다. **정본은 이 문서다.** chris-server 레포의 `knowledge/development/openclaw-fork.md` 는 좌표만 담은 요약이다.

- 포크 생성일: 2026-09-06 (KST, 일요일)
- 기준 태그: **v2026.9.2** (커밋 `3928bad9badfcb6c7d140530435e806fb8092190`, "docs: finalize 2026.9.2 release notes")
- 상위 라이선스: MIT (c) OpenClaw Foundation. `LICENSE` 와 `THIRD_PARTY_NOTICES.md` 는 그대로 유지한다.
- **코드베이스 구조**(어디가 백엔드·프런트인지, 인프라 요구, 데이터베이스)는 별도 문서다: [chris-local/CODEBASE.md](chris-local/CODEBASE.md) (HTML 판 `chris-local/codebase.html`).
- **문서 미리보기**(PDF·Word·Excel·PowerPoint 를 파일 패널에서 바로 보기, 한글 폰트 포함)는 별도 문서다: [chris-local/FILE-PREVIEW.md](chris-local/FILE-PREVIEW.md).

---

## 1. 왜 포크했나

npm 배포본(`npm i -g openclaw`)은 바이너리라 **고칠 수가 없다.** 홈랩 게이트웨이[<sup>1</sup>](#g1) claw01 은 배포본을 쓰고 있어서 동작을 바꾸려면 업스트림이 고쳐 주기를 기다려야 한다. 이 포크의 목적은 세 가지다.

1. **소스 소유권.** 전체 모노레포를 로컬에 두고 직접 빌드해서, 원하는 지점을 바로 고칠 수 있게 한다.
2. **개조 가능성 실증.** Control UI 브랜딩처럼 설정 키가 없는 지점을 소스 수정으로 바꿀 수 있는지 실제로 확인한다.
   (업스트림 문서에는 제품명·로고 교체용 설정 키가 없다. 화이트라벨은 곧 소스 포크다.)
3. **홈랩 이식성.** 리눅스에서 빌드해 두면 claw01 로 그대로 옮길 수 있다.

상표 주의: 코드는 MIT 라 자유롭지만 **"OpenClaw" 이름과 로브스터 마스코트는 별개 권리**다. **2026-09-06 에 사용자에게 보이는 이름과 마스코트를 전부 걷어냈다**(5장). 표시 문자열과 이미지는 이 포크의 것으로 바꾸고, 라이선스 고지만 원문 그대로 남겼다.

---

## 2. 좌표

| 항목                   | 값                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| 포크 (origin)          | `https://github.com/necromman/openclaw` (necromman 계정)                                 |
| 업스트림 (upstream)    | `https://github.com/openclaw/openclaw`                                                   |
| **빌드 정본 체크아웃** | **WSL2 Ubuntu 24.04: `~/openclaw`** (= `\\wsl.localhost\Ubuntu\home\necromman\openclaw`) |
| 편집·IDE 체크아웃      | Windows: `D:\PROJECT\openclaw`                                                           |
| 로컬 인스턴스 홈       | WSL: `~/openclaw-local/` (설정·상태·워크스페이스·로그)                                   |
| 기본 브랜치            | `main` (= 태그 v2026.9.2 로 맞춰 둠)                                                     |
| 작업 브랜치            | **`chris/main`** (모든 커스터마이즈는 여기에 쌓는다)                                     |
| Node                   | WSL **v24.20.0** (nvm). 저장소 요구: `>=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0`    |
| pnpm                   | **12.1.0** (corepack, `package.json` 의 `packageManager` 핀)                             |
| Control UI             | `http://127.0.0.1:18789/` (loopback 전용)                                                |

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
  그래서 우리 동기화 모델은 **"다음 릴리스 태그로 갈아탄다"** 다.

### 3-1. 포크 push 함정 (겪은 것, 재발 방지)

gh CLI 토큰[<sup>2</sup>](#g2) 스코프가 `repo` 뿐이고 `workflow` 가 없으면, `.github/workflows/` 내용이 달라지는 push 가 이 메시지로 거부된다.

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

## 5. 브랜딩 (2026-09-06 전면 교체)

사용자에게 보이는 업스트림 제품명과 마스코트를 전부 걷어냈다. 기능은 하나도 없애지 않았다.\
전수 조사 결과와 근거는 **[chris-local/BRANDING-AUDIT.md](chris-local/BRANDING-AUDIT.md)** 가 정본이고, 여기에는 좌표만 적는다.

### 5-1. 이름을 바꾸는 법

`src/brand.ts` **한 파일**이 정본이다. `BRAND_NAME` 을 고치면 Control UI 탭 제목, About 히어로, PWA 매니페스트, 모바일 상단바, 로그인 화면, CLI 배너, `--version`, 시스템 프롬프트 페르소나, 웹푸시 알림 제목이 전부 따라온다.

```ts
// src/brand.ts
export const BRAND_NAME = "Chris Agent"; // 임시값. 여기만 바꾸면 된다
export const BRAND_SHORT_NAME = "Chris";
export const BRAND_TAGLINE = "Your personal AI assistant, running on your own devices.";
export const BRAND_LINKS = { website: "", docs: "...FORK.md", github: "...", discord: "", x: "" };
```

빈 문자열(`""`)은 "이 포크에는 그런 목적지가 없다"는 뜻이고, About 링크 줄과 사이드바 커뮤니티 메뉴가 아예 렌더되지 않는다.\
`ui/src/brand.ts` 는 이 파일을 재수출만 한다(Control UI 번들 경로). 값을 거기에 적지 마라.

i18n 문자열은 `{brand}`·`{brandShort}`·`{brandSkillHub}`·`{brandCloud}` 플레이스홀더를 쓴다. `t()` 와 설치 마법사 `interpolate()` 가 항상 주입하므로 호출부에서 넘길 필요가 없다.

### 5-2. 로고·아이콘

| 파일                                                                | 내용                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ui/public/favicon.svg`                                             | 중립 기하 마크(둥근 판 + 링 + "C" 아크). 파비콘·apple-touch·어시스턴트 아바타의 원본 |
| `ui/public/favicon-32.png` · `favicon.ico` · `apple-touch-icon.png` | 같은 도형을 래스터한 것                                                              |
| `ui/src/components/brand-mark.ts`                                   | 같은 도형의 lit 인라인 SVG (About 히어로)                                            |
| `ui/src/components/icons-tools.ts` 의 `lobster`                     | 아이콘 키 이름은 식별자라 그대로, 그림만 브랜드 마크                                 |

마크를 바꾸려면 `favicon.svg` 와 `brand-mark.ts` 와 `icons-tools.ts` 세 곳의 같은 도형을 함께 고치고, PNG/ICO 를 다시 굽는다. 네이티브 앱(`apps/`) 아이콘은 아직 교체하지 않았고 방법만 감사 문서 5장에 적어 뒀다.

### 5-3. 일부러 남긴 것

- **내부 식별자**: npm 패키지명 `openclaw`, CLI 실행파일과 하위 명령(`openclaw doctor` 등), 설정 디렉터리 `~/.openclaw`, 설정 키, 환경변수, 커스텀 엘리먼트(`<openclaw-app>`), CSS 클래스, API 경로, i18n 키, 코드 심볼. 이걸 바꾸면 업스트림 리베이스가 불가능해진다. 사용자에게는 CLI 명령을 "내부 이름"으로 안내한다.
- **라이선스 고지**: `LICENSE`, `THIRD_PARTY_NOTICES.md`, 소스 상단 저작권 주석, About 하단의 "© 2026 OpenClaw Foundation - MIT License." 는 MIT 조건이자 사실 관계라 원문 그대로 둔다. 브랜드를 바꾸는 것과 저작권 귀속을 지우는 것은 다른 일이다.
- **업스트림 문서**: `CHANGELOG.md`·`docs/`·`AGENTS.md` 등은 내부 문서다. Control UI 안의 `docs.openclaw.ai` 딥링크도 실제로 동작하는 도움말이라 유지하고, About 의 대표 링크만 포크 저장소로 바꿨다.

---

## 5-A. 스타일 공통화 (2026-09-06)

포크 공통 스타일 계층은 **`ui/src/styles/fork-style.css`** 한 파일이다. `ui/src/styles.css` 의 **마지막 import** 라서 업스트림 파일을 고치지 않고도 값을 덮는다.

### 5-A-1. 상세 페이지 full width

`.settings-page`(760px)와 `.settings-page--wide`(1120px), settings 셸 헤더(1120px)가 콘텐츠를 가운데 좁은 칼럼에 가두고 있었다. 자동화 화면 좌측 절반이 비어 보이던 원인이 이것이다.

```css
:root {
  --page-max-width: none;
} /* 길이를 넣으면 다시 캡이 걸린다 */
```

`.settings-page` 는 `components/settings-ui.ts` 의 `renderSettingsPage()` 가 쓰는 **공용 컨테이너**라, 이 한 토큰으로 설정 전 하위 페이지·자동화·플러그인·세션·기기·사용량·시크릿·정보가 전부 창 폭을 쓴다. 상하좌우 패딩(`--space-3`/`--space-4`/`--space-8`, 대략 24~32px)은 그대로다.

**제외**: 채팅은 `--chat-thread-max-width` 를 쓰는 별도 계통이라 손대지 않았다. 대화 지문의 읽기 폭 제한은 유지된다.

페이지별 하드코딩 max-width 는 `rg -n "max-width" ui/src/styles` 로 전수 조사했고, 페이지 폭을 가두는 것은 위 두 클래스와 셸 헤더 규칙뿐이었다. 나머지는 툴팁·토스트·드롭다운·아바타 같은 부품 폭이라 그대로 둔다.

### 5-A-2. 라운드 5px 상한

```css
:root {
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 5px;
  --radius-xl: 5px;
  --radius: 4px;
  --radius-full: 9999px; /* 원형 전용: 아바타·상태 점·스피너·토글 */
  --openclaw-corner-radius-scale: 0.25; /* base.css 의 고정 px 코너까지 5px 이하로 */
  --radius-pill: var(--radius-lg); /* pill·chip 도 5px */
}
```

`--openclaw-corner-radius-scale` 은 업스트림이 이미 가진 신호다. `base.css` 의 `@supports (corner-shape)` 블록이 14px/10px/20px 를 이 배수로 곱해 그리므로, 0.25 를 주면 그 블록을 건드리지 않고 3.5px/2.5px/5px 가 된다(`crt` 테마가 쓰는 것과 같은 수법).

토큰을 안 읽는 하드코딩 값은 전수 조사해 캡했다: CSS 82건, lit `css` 블록 23건(`rg -n "border-radius" ui/src`). `50%` 와 `999px` 은 원형이라 남겼다.

**바꾸는 법**: 위 블록의 값 하나만 고치면 전 화면이 따라온다. 페이지 스타일시트에 `border-radius` 를 새로 하드코딩하지 마라.

**규칙: 줄이기만 하고, 0 은 0 으로 둔다.** 이 오버라이드는 기존 라운드를 5px 이하로 **줄이는 것만** 한다. 업스트림에서 `border-radius: 0` 이던 요소에 라운드를 새로 주면 안 된다.

실제로 한 번 어겼다. pill 평탄화 목록에 `.hub-tab` 을 넣었더니 원래 각지던 탭에 5px 가 붙어 활성 탭 하단 인디케이터 끝이 둥글어졌다(회귀, `2de2679` 에서 수정). 그래서 두 가지를 지킨다.

- pill 목록에는 **업스트림에서 `--radius-full` 을 읽던 셀렉터만** 넣는다. `rg -n -A6 "<셀렉터> \{" ui/src/styles` 로 먼저 확인하고 추가한다.
- 탭 인디케이터·언더라인·`hr`·`[role="separator"]`·`progress` 같은 **선 성격 요소는 `border-radius: 0` 으로 명시**한다. 단 여기에도 0 임을 확인한 셀렉터만 넣는다. `.settings-segmented` 처럼 원래 `--radius-md` 를 읽던 것은 토큰 캡이 줄이도록 두고 각지게 만들지 않는다.

### 5-A-3. 라우트·탭별 full width 적용표 (1440px 실측)

측정법: 각 라우트에서 `main.content` 의 **콘텐츠 박스 폭**(패딩 제외) 대비 페이지 컨테이너 폭. 90% 미만이면 어딘가 캡이 남아 있다는 뜻이다.

```js
// 브라우저 콘솔
const inner = (el) => {
  const c = getComputedStyle(el);
  return el.getBoundingClientRect().width - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight);
};
const page = document.querySelector(
  ".settings-page, .content--skill-workshop, .sw-today, .config-lead",
);
Math.round(
  (page.getBoundingClientRect().width / inner(document.querySelector("main.content"))) * 100,
);
```

| 라우트 / 탭                          | 경로                        | 폭 비율              | 비고                                                  |
| ------------------------------------ | --------------------------- | -------------------- | ----------------------------------------------------- |
| 홈(채팅)                             | `/chat/*`                   | 100% (**제외 대상**) | 대화 지문은 `--chat-thread-max-width` 로 읽기 폭 유지 |
| 대시보드                             | `/dashboards`               | 100%                 |                                                       |
| 자동화 (전체·활성·일시중지·실행기록) | `/automations`              | 100%                 | 탭 4개가 같은 페이지 컨테이너 공유                    |
| 세션 목록                            | `/sessions`                 | 100%                 |                                                       |
| 활동                                 | `/activity`                 | 100%                 |                                                       |
| 사용량                               | `/usage`                    | 99%                  |                                                       |
| 작업                                 | `/tasks`                    | 99%                  |                                                       |
| 플러그인 설치됨·둘러보기             | `/settings/plugins`         | 99%                  |                                                       |
| 플러그인 Skills                      | `/skills`                   | 99%                  |                                                       |
| 플러그인 워크숍 (보드·오늘)          | `/skills/workshop`          | 100%                 | **이번에 수정**: 1120px·720px 캡 해제                 |
| 설정 > 정보                          | `/settings/about`           | 99%                  |                                                       |
| 설정 > 프로필                        | `/settings/profile`         | 99%                  |                                                       |
| 설정 > 화면 설정                     | `/settings/appearance`      | 95%                  | 폼 자체 폭, 캡 없음                                   |
| 설정 > 알림                          | `/settings/notifications`   | 96%                  |                                                       |
| 설정 > Gateway                       | `/settings/connection`      | 99%                  |                                                       |
| 설정 > 채널                          | `/settings/channels`        | 99%                  |                                                       |
| 설정 > 커뮤니케이션                  | `/settings/communications`  | 95%                  |                                                       |
| 설정 > 음성 대화                     | `/settings/talk`            | 99%                  |                                                       |
| 설정 > 에이전트                      | `/settings/agents`          | 99%                  |                                                       |
| 설정 > AI 에이전트                   | `/settings/ai-agents`       | 95%                  |                                                       |
| 설정 > 실험실                        | `/settings/labs`            | 99%                  |                                                       |
| 설정 > 모델                          | `/settings/model-providers` | 99%                  |                                                       |
| 설정 > MCP                           | `/settings/mcp`             | 99%                  |                                                       |
| 설정 > 메모리 (개요·기억·꿈·설정)    | `/settings/memory`          | 99%                  | 탭 4개 모두 같은 컨테이너                             |
| 설정 > 자동화                        | `/settings/automation`      | 95%                  |                                                       |
| 설정 > 개인정보·보안                 | `/settings/security`        | 100%                 |                                                       |
| 설정 > 비밀정보                      | `/settings/secrets`         | 100%                 |                                                       |
| 설정 > 승인                          | `/settings/approvals`       | 99%                  |                                                       |
| 설정 > 기기                          | `/settings/devices`         | 99%                  |                                                       |
| 설정 > 기기 상세                     | `/settings/device`          | 100%                 |                                                       |
| 설정 > 클라우드 워커                 | `/settings/cloud-workers`   | 100%                 |                                                       |
| 설정 > 인프라                        | `/settings/infrastructure`  | 95%                  |                                                       |
| 설정 > 고급                          | `/settings/advanced`        | 95%                  |                                                       |
| 설정 > 업데이트                      | `/settings/updates`         | 99%                  |                                                       |
| 설정 > 워크트리                      | `/settings/worktrees`       | 100%                 |                                                       |
| 디버그                               | `/debug`                    | 99%                  |                                                       |
| 연결 화면(로그인 게이트)             | 미인증 `/`                  | 카드 중앙 정렬 유지  | 폼 카드라 **의도적 예외**                             |
| 앱 다운로드                          | `/apps`                     | 해당 없음            | 5-B 로 숨김                                           |

90% 미만은 없다. `.settings-page` 를 안 쓰고 자체 중앙 칼럼을 두던 컨테이너 5개(`.content--skill-workshop`·`.sw-today`·`.config-lead`·`.config-content-callout`·플러그인 허브 헤더)를 `--page-max-width` 로 넘겨 해결했다.

### 5-A-4. 폼 컨트롤 높이

업스트림은 `--settings-control-height` 를 **네이티브** `input.settings-input` / `select.settings-select` 에만 건다. Web Awesome `<wa-select>` 는 커스텀 엘리먼트라 그 규칙에 안 걸려 38px 로 남았고, 32px 입력과 나란히 놓이면 중심이 3px 어긋났다(자동화 "주기" 행). `fork-style.css` 가 `wa-select.settings-select` 와 그 `::part(combobox)` 에 같은 토큰을 주고 인라인 컨트롤 그룹을 `align-items: center` 로 맞춘다. 새 폼에서 입력과 셀렉트를 나란히 놓을 때 높이를 따로 지정하지 마라.

---

## 5-B. 숨긴 기능

`src/brand.ts` 의 `BRAND_FEATURES` 가 "코드는 두되 노출만 막는" 스위치다. 기능을 지우지 않으므로 업스트림 리베이스가 그대로 붙고, 값을 `true` 로 되돌리면 전부 복구된다.

| 플래그     | 기본값  | 숨기는 것                                                                                                                                                | 되살리는 법                          |
| ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `appsPage` | `false` | 소유자 메뉴의 "앱 다운로드" 행, 기기 페어링 대화상자의 "앱 받기" 버튼, 커맨드 팔레트의 앱 카드 항목, `/apps` 라우트(직접 접근하면 `/chat` 으로 redirect) | `src/brand.ts` 에서 `appsPage: true` |

진입점을 새로 막을 때는 **라우터 loader 에 redirect 한 줄 + 메뉴 조건 렌더**만 쓴다. 라우트 테이블에서 페이지를 빼면 업스트림이 그 배열을 건드릴 때마다 충돌한다. `/apps` redirect 는 `loaderDeps` 가 있어야 로더가 도는 점에 주의한다(`ui/src/pages/apps/route.ts`).

---

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

### 6-3. WSL 유휴 종료로 게이트웨이가 죽는 문제 (해결됨)

**증상.** 세션이 없으면 WSL2 가 배포판을 내린다. 그러면 systemd user 매니저째로 내려가 `loginctl enable-linger` 를 켜 놨어도 게이트웨이가 같이 죽는다. "방금 200 이던 `http://127.0.0.1:18789/` 가 갑자기 ECONNREFUSED" 가 그것이다.

**먼저 시도했고 그것만으로는 안 됐던 것.** `%USERPROFILE%\.wslconfig` 에 다음을 넣고 `wsl --shutdown` 으로 적용했다.

```ini
[wsl2]
vmIdleTimeout=-1
```

이것만 걸고 **WSL 세션 없이 16분** 둔 뒤 확인했더니 `wsl -l -v` 가 `Ubuntu  Stopped` 였고 Control UI 는 연결 거부였다. `vmIdleTimeout` 은 유틸리티 VM 쪽 설정이라 **배포판 자체가 내려가는 것은 막지 못했다**(이 PC 실측). 설정 자체는 해가 없어 그대로 두었지만, **이것만 믿으면 안 된다.**

**실제로 통하는 조치: Windows 작업 스케줄러가 WSL 세션을 하나 붙잡는다.** Claude/터미널 세션에 묶이지 않으므로 그 세션이 끝나도 살아남는다.

```powershell
$act = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d Ubuntu -- sleep infinity'
$t1  = New-ScheduledTaskTrigger -AtLogOn
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'OpenClawWSLKeepalive' -Action $act -Trigger $t1 -Settings $set -Force
Start-ScheduledTask -TaskName 'OpenClawWSLKeepalive'     # 지금 즉시 살리기
```

`-ExecutionTimeLimit ([TimeSpan]::Zero)` 가 중요하다. 기본값(3일)이면 사흘 뒤 작업이 강제 종료돼 같은 증상이 돌아온다.

확인 / 중지:

```powershell
(Get-ScheduledTask -TaskName 'OpenClawWSLKeepalive').State   # Running 이어야 한다
Stop-ScheduledTask  -TaskName 'OpenClawWSLKeepalive'
Unregister-ScheduledTask -TaskName 'OpenClawWSLKeepalive' -Confirm:$false
```

**로그온 시 자동 기동.** 위 작업이 로그온 트리거를 갖고 있어서 로그온하면 WSL 이 깨어나고, linger 덕에 `openclaw-local.service` 와 `openclaw-auto-deploy.timer` 가 알아서 올라온다. 별도로 `WakeWSL-OpenClaw`(`wsl.exe -d Ubuntu -- true`) 작업도 같은 트리거로 등록해 뒀다(깨우기 전용, 상주하지 않음).

**실측.** `wsl --shutdown` 후 비대화 호출 한 번(`wsl -d Ubuntu -- true`)만으로 두 유닛이 자동 복귀하고 Control UI 가 HTTP 200 을 냈다. 그 뒤 상주 작업을 건 상태에서 **WSL 을 따로 열지 않고 16분 이상 방치**한 확인에서도 Control UI 가 HTTP 200 이었다.

---

## 7. 구동 / 중지 / 설정

로컬 인스턴스는 **홈랩 claw01 과 완전히 분리**돼 있다. 별도 홈(`~/openclaw-local`), 별도 설정·상태, 별도 게이트웨이 토큰을 쓰고, **채널(텔레그램 등)은 하나도 붙이지 않았다.** 홈랩 봇 토큰을 여기에 넣으면 polling 이 충돌하므로 넣지 않는다.

### 7-1. 최초 설치

```bash
cd ~/openclaw
bash chris-local/install.sh
```

`chris-local/install.sh` 가 하는 일 (멱등[<sup>3</sup>](#g3)): 게이트웨이 토큰 생성 → 설정 patch → `config validate` → systemd user 서비스 설치·기동.

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

| 항목            | 값                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------- |
| 포트            | **18789** (Windows 쪽에서 18789/18790/18791 모두 비어 있음을 확인하고 기본값 사용)       |
| bind            | `loopback` (127.0.0.1 과 ::1 에만 붙는다. LAN 노출 없음)                                 |
| 인증            | `gateway.auth.mode=token` + 레이트리밋 (10회/60초, 5분 락아웃)                           |
| 설정 파일       | `~/openclaw-local/.openclaw/openclaw.json` (0600)                                        |
| 상태·세션 DB    | `~/openclaw-local/.openclaw/state/openclaw.sqlite`                                       |
| 워크스페이스    | `~/openclaw-local/.openclaw/workspace`                                                   |
| 게이트웨이 토큰 | `~/openclaw-local/.openclaw/gateway-token.txt` (0600, **git 미추적**)                    |
| 서비스 로그     | `~/openclaw-local/gateway.log`                                                           |
| 서비스          | systemd **user** 유닛 `openclaw-local.service` (`~/.config/systemd/user/`)               |
| Control UI      | `http://127.0.0.1:18789/` - Windows 브라우저에서 WSL2 localhost 포워딩으로 그대로 열린다 |

`openclaw gateway install` 은 **쓰지 않는다.** 비기본 state dir 을 쓰면 `service management skipped: non-default state dir or config path` 로 거부하기 때문에, 이 포크는 `chris-local/openclaw-local.service` 로 유닛을 직접 들고 있다.

### 7-4. WSL 에서 한 시스템 변경 (재현용 기록)

| 변경                    | 명령                                                                        | 이유                                                           |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| nvm + Node 24 설치      | 6-1 참조                                                                    | 배포판 Node 18 은 요구 버전 미달                               |
| `~/.config` 소유권 수정 | `sudo chown -R $USER:$USER ~/.config` (root 셸에서 실행)                    | root 소유라 systemd user 유닛을 못 만들었다                    |
| linger 활성화           | `loginctl enable-linger $USER`                                              | 로그아웃 후에도 user 서비스 유지                               |
| git 자격증명            | `git config --global credential.helper store` + `~/.git-credentials` (0600) | WSL 에는 gh CLI 미설치. GitHub 토큰은 Windows gh 에서 가져왔다 |

---

## 7-5. 자동 반영 (Windows 에서 고치고 push 하면 WSL 이 알아서 따라온다)

편집은 `D:\PROJECT\openclaw`, 실행은 WSL `~/openclaw` 라는 두 체크아웃 구조에서 손으로 pull 하고 빌드하는 것을 없애기 위한 레인이다. **Windows 에서 커밋·푸시만 하면 2분 안에 WSL 인스턴스가 스스로 pull 하고 빌드하고 게이트웨이를 재시작한다.**

```
D:\PROJECT\openclaw  --(git push origin chris/main)-->  GitHub 포크
                                                            |
                                       (2분 타이머) auto-deploy.sh 가 fetch
                                                            |
                        SHA 가 움직였을 때만: pull --ff-only -> (lock 바뀌었을 때만) pnpm install
                                            -> pnpm build -> 성공했을 때만 게이트웨이 재시작
                                                            |
                                                 ~/openclaw (WSL) 에 반영
```

### 설치

```bash
cd ~/openclaw
bash chris-local/install-auto-deploy.sh
```

systemd user 매니저가 있으면 **2분 주기 systemd user 타이머**(`openclaw-auto-deploy.timer`)를 걸고, 없으면 같은 주기의 `nohup` 폴링 루프로 대체한다.

### 즉시 반영 (타이머를 안 기다리고 손으로)

```bash
# Windows Git Bash / PowerShell 에서 바로
wsl -d Ubuntu -- bash -lc '~/openclaw/chris-local/auto-deploy.sh --now'

# SHA 가 안 움직였어도 강제로 다시 빌드·재시작
wsl -d Ubuntu -- bash -lc '~/openclaw/chris-local/auto-deploy.sh --force'
```

### 안전 규칙 (이 스크립트가 지키는 것)

| 규칙                                                  | 왜                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `flock` 단일 실행                                     | 빌드가 4분 넘게 걸리므로 2분 타이머가 앞 실행과 겹치면 안 된다. 겹치면 뒤 tick 은 그냥 빠진다 |
| 원격 SHA 가 로컬과 같으면 아무것도 안 한다            | 평상시 타이머는 `git fetch` 한 번으로 끝난다                                                  |
| `pnpm install` 은 `pnpm-lock.yaml` 이 바뀐 커밋에서만 | 매번 install 하면 2분 주기를 못 지킨다                                                        |
| `git pull --ff-only`                                  | WSL 쪽에 로컬 커밋이 생겨 히스토리가 갈라지면 조용히 머지하지 않고 **실패로 남긴다**          |
| pull 전에 빌드 산출물만 되돌린다                      | 빌드가 다시 쓰는 추적 파일(아래) 때문에 `--ff-only` 가 계속 거절되는 것을 막는다. 되돌린 파일은 로그에 이름이 남고, 그 밖의 더러움은 예전처럼 FAIL 로 남되 `git status --short` 가 로그에 함께 찍힌다 |
| 빌드 성공했을 때만 재시작                             | 빌드가 깨지면 돌던 게이트웨이는 **이전 빌드 그대로 계속 서비스**하고 로그에만 사유가 남는다   |
| 재시작 후 HTTP 200 확인                               | 재시작은 됐는데 안 뜨는 경우를 `WARN` 으로 구분한다                                           |

### 상태 확인 / 실패 확인법

```bash
# 배포 이력 (KST 시각 + SHA)
wsl -d Ubuntu -- bash -lc 'tail -20 ~/openclaw/chris-local/auto-deploy.log'

# 타이머가 살아 있나 / 다음 실행 언제
wsl -d Ubuntu -- bash -lc 'systemctl --user list-timers openclaw-auto-deploy.timer --no-pager'

# 마지막 실행 자체가 실패했나
wsl -d Ubuntu -- bash -lc 'systemctl --user status openclaw-auto-deploy.service --no-pager | head -20'
```

로그에 `FAIL:` 이 보이면 그 줄이 원인을 그대로 말한다. 자주 나올 것은 셋이다.

- `git pull --ff-only rejected` - WSL 체크아웃에 로컬 커밋이 생겼다. `cd ~/openclaw && git status` 로 확인하고 커밋을 포크에 올리거나 버린다.
- `pnpm build failed` - 소스가 깨졌다. 게이트웨이는 이전 빌드로 계속 돈다. 로그의 빌드 출력이 그대로 붙어 있으니 거기서 원인을 본다. (주의: 실패한 빌드가 `dist/` 를 부분적으로 덮었을 수 있으므로, 고친 뒤 다음 성공 빌드까지는 `dist/` 를 신뢰하지 않는다.)
- `pnpm install failed` - 락파일과 레지스트리가 안 맞는다.

### 타이머 중지 / 재개

```bash
# 중지 (자동 반영 끄기)
wsl -d Ubuntu -- bash -lc 'systemctl --user disable --now openclaw-auto-deploy.timer'

# 재개
wsl -d Ubuntu -- bash -lc 'systemctl --user enable --now openclaw-auto-deploy.timer'

# nohup 루프 모드로 돌고 있을 때 중지
wsl -d Ubuntu -- bash -lc 'pkill -f openclaw-auto-deploy-loop'
```

### 실측 (2026-09-06, 무개입 확인)

Windows 체크아웃에서 Control UI 제목에 `v2` 를 붙인 커밋 `14513fdec725` 를 `git push origin chris/main` 한 것 외에 **아무 조작도 하지 않았다.**

```
2026-09-06 15:57:02 KST  deploy start: 07de85cd4e2e -> 14513fdec725 (origin/chris/main, mode=timer)
2026-09-06 16:00:51 KST  OK: deployed 14513fdec725, Gateway restarted and answering HTTP 200
```

- 푸시 시각 약 15:56 -> 타이머가 15:57:02 에 잡음(주기 2분) -> 빌드 3분 41초 -> 16:00:51 재시작 완료. **push 에서 반영까지 약 4분.**
- 그 직전 15:54:58 타이머 tick 은 SHA 가 안 움직여서 로그 한 줄 없이 넘어갔다(설계대로).
- 반영 확인: `curl -s http://127.0.0.1:18789/ | grep -oE '<title>[^<]*</title>'` -> `<title>OpenClaw Control (Chris fork v2)</title>`

### 실제로 한 번 실패했고, 그 실패가 설계대로였다

같은 날 다음 커밋(`56c103409ed5`)에서 `FAIL` 이 났다. 원인·복구를 그대로 남긴다.

```
16:03:02 KST  deploy start: 14513fdec725 -> 56c103409ed5 (origin/chris/main, mode=timer)
16:03:03 KST  FAIL: git pull --ff-only rejected (local commits or diverged history). Gateway left running on 14513fdec725
16:04:19 KST  deploy start: 14513fdec725 -> 56c103409ed5 (origin/chris/main, mode=now)
16:05:32 KST  OK: deployed 56c103409ed5, Gateway restarted and answering HTTP 200
```

원인은 **파일 실행권한 드리프트**였다. 설치 스크립트가 `chmod +x chris-local/*.sh` 를 하는데 git 에는 `100644` 로 들어가 있어서, pull 할 때마다 워크트리가 `mode change 100644 => 100755` 로 더러워졌다. 그 상태에서 같은 파일의 모드를 바꾸는 커밋이 들어오자 `--ff-only` 가 거부했다.

**중요한 건 이때 게이트웨이가 멀쩡히 이전 빌드로 계속 돌았다는 것이다.** 설계 의도대로 임의 머지도, 부분 반영도 하지 않았다.

복구:

```bash
# 1. 무엇이 더러운지 본다
wsl -d Ubuntu -- bash -lc 'cd ~/openclaw && git status --porcelain'

# 2. 내 변경이 아니라 드리프트면 버린다 (내 변경이면 먼저 포크에 올린다)
wsl -d Ubuntu -- bash -lc 'cd ~/openclaw && git checkout -- chris-local/'

# 3. 타이머를 안 기다리고 즉시 재시도
wsl -d Ubuntu -- bash -lc '~/openclaw/chris-local/auto-deploy.sh --now'
```

근본 수정은 커밋 `240e0fb51ad` 에서 실행권한을 `100755` 로 인덱스에 박은 것이다. 이제 `chmod +x` 가 no-op 이라 드리프트가 다시 생기지 않는다.

### 로그 파일이 git 을 더럽히지 않는 이유

`chris-local/auto-deploy.log` 는 저장소 안에 있지만 `.git/info/exclude` 에 자동 등록된다(스크립트가 멱등하게 넣는다). 업스트림 `.gitignore` 를 건드리지 않으므로 리베이스 충돌이 생기지 않고, 워크트리는 깨끗하게 유지돼 `--ff-only` pull 이 막히지 않는다.

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

| 항목                             | 결과                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | exit 0                                                                              |
| `pnpm build`                     | exit 0                                                                              |
| `pnpm ui:build`                  | exit 0                                                                              |
| `openclaw --version`             | `OpenClaw 2026.9.2 (3928bad)` (소스 커밋 해시가 찍힌다 = 배포본이 아니라 우리 빌드) |

### 10-2. 구동

| 항목                          | 결과                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| systemd user 서비스           | `active (running)`                                                                                                                                                                        |
| 리스너                        | `127.0.0.1:18789`, `[::1]:18789`                                                                                                                                                          |
| Control UI (WSL 내부)         | HTTP 200                                                                                                                                                                                  |
| Control UI (Windows 브라우저) | HTTP 200 (WSL2 localhost 포워딩 동작)                                                                                                                                                     |
| 기기 페어링                   | loopback 자동 승인 (`device pairing auto-approved ... role=operator`)                                                                                                                     |
| 로드된 플러그인               | 16개 (acpx, browser, canvas, cua-computer, device-pair, file-transfer, geolocation, google-meet, linux-node, memory-core, ollama, openai, talk-voice, teams-meetings, xai, zoom-meetings) |

### 10-2b. 테스트 (`pnpm check` / `pnpm test`)

| 명령                                             | 결과                                                     |
| ------------------------------------------------ | -------------------------------------------------------- |
| `pnpm check` (포맷·린트·타입·아키텍처 가드 전량) | **exit 0, 실패 0**                                       |
| `pnpm test` (전체 스위트, 약 2시간)              | **exit 1** - 통과 **192,671** / 실패 **450** / 스킵 다수 |

실패 450건은 **전부 환경 의존이고 우리 변경과 무관하다.** 이 실행은 커스터마이즈가 들어가기 전의 순정 태그 트리에서 돌렸으므로 업스트림 v2026.9.2 자체의 이 환경에서의 상태다.

| 분류                                         | 건수    | 원인                                                                                              | 근거                                                                                                                                |
| -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `tooling` 레인 (PR·릴리스 셸 자동화)         | **419** | **`jq` 미설치**                                                                                   | 로그에 `scripts/pr-lib/merge-outcome.sh: line 14: jq: command not found` 가 직접 찍힌다. `apt-get install -y jq` 로 해소되는 종류다 |
| `extension-browser` (browser control server) | 20      | 헤드리스 WSL 에 실제 브라우저/CDP 대상이 없음                                                     | `server.agent-contract-core`, `server-context.remote-profile-tab-ops.fallback` 두 파일에 집중                                       |
| `unit-fast-isolated` `entry.respawn`         | 5       | 프로세스 respawn 이 WSL 환경에 의존                                                               |                                                                                                                                     |
| `gateway-core` `portal-http-proxy`           | 1       | **IPv6 전용 타깃**으로 접속하는 케이스. WSL2 네트워크 스택 제약                                   | 테스트명에 `reaches IPv6-only targets`                                                                                              |
| `ui` `sessions-page.typing`                  | 1       | 타이밍 플레이키 (`expected 1 to be +0`)                                                           | 같은 파일의 다른 변형은 전부 통과                                                                                                   |
| 기타 산발                                    | 4       | `browser-open`, `portal-stream-command`, `package-acceptance-workflow`, codex `native-hook-relay` | 모두 외부 바이너리·네트워크 의존                                                                                                    |

**업스트림 CI 대조는 하지 못했다** (포크 CI 를 돌리려면 `workflow` 스코프가 필요하고, 이 환경에서 그 스코프를 얻지 못했다 - 3-1 참조). 대신 **원인을 로그에서 직접 특정**했다: `jq` 미설치는 메시지가 그대로 나오고, 나머지는 브라우저·IPv6·프로세스 respawn 같은 호스트 능력 부재다. 소스 결함으로 분류할 근거가 있는 실패는 **없다**.

`jq` 는 그 뒤 설치했다(`apt-get install -y jq`, jq-1.7). 새 환경을 만들 때는 **`pnpm test` 전에 `jq` 를 먼저 깔면 419건이 사라진다.**

### 10-2c. jq 설치 후 tooling 레인 재실행 (분류 확정)

`jq` 를 깔고 tooling 레인만 다시 돌렸다.

| 실행               | tooling 레인 실패                               |
| ------------------ | ----------------------------------------------- |
| 최초 (`jq` 없음)   | **419**                                         |
| 재실행 (`jq` 있음) | **103** (통과 15,608 / 파일 578 통과 · 13 실패) |

남은 103건은 **또 다른 실패이고, 그나마 내 실행 방법이 만든 것이다.** 전부 같은 에러다.

```
Error: EACCES: permission denied, mkdtemp '/oc-default-empty-XXXXXX'
  at makeTempDir test/helpers/temp-dir.ts:38
```

임시 디렉터리 루트가 **파일시스템 루트 `/`** 로 잡혔다(`/tmp` 여야 한다). 재실행을 `pnpm vitest run --config ...` 로 **직접** 돌리면서 저장소 공식 러너 `scripts/test-projects.mts` 가 세팅하는 temp/state 환경을 건너뛴 탓이다.

근거는 명확하다. 문제의 `test/scripts/test-projects-empty-native.test.ts` 는 **공식 `pnpm test` 실행에서 38개 케이스 전부 통과했고 실패 0건**이었다. 즉 호출 방식 문제다.

**결론: `jq` 가 있고 공식 러너(`pnpm test`)로 돌리면 tooling 레인 실패는 사라진다.** 레인만 따로 검증할 때도 `pnpm vitest` 직접 호출 대신 `pnpm test` 를 쓰는 것이 맞다.

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

| 항목                              | 내용                                                | 판정                                                                                                      |
| --------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `gateway.trusted_proxies_missing` | bind 가 loopback 인데 `trustedProxies` 가 비어 있다 | **의도된 것.** 리버스 프록시를 안 쓰는 로컬 전용 인스턴스다                                               |
| `gateway.probe_failed`            | deep 프로브가 `missing scope: operator.read`        | CLI 기기에 operator.read 스코프가 없어서 나는 것. 게이트웨이 자체는 정상 (HTTP 200 + 실제 채팅 왕복 성공) |

### 10-5. `openclaw doctor`

경고는 모두 **"설정 안 함"** 계열이고 결함이 아니다.

| 경고                           | 원인                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| GitHub 검색이 public-only      | `gateway.controlUi.github.token` 미설정 (의도)                     |
| Legacy Browser Relay Auth 켜짐 | 업스트림 기본값. 브라우저 확장을 안 쓰므로 방치                    |
| 스킬 30개 사용 불가            | 외부 바이너리·API 키 미설치 (1password, github, spotify-player 등) |
| Memory search 비활성           | `OPENAI_API_KEY` 미설정. Anthropic 만 붙였다                       |

---

### 10-6. Docker 경로

| 항목                                       | 결과                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker build -t openclaw-chris:local .`   | **exit 0**, 이미지 4.37GB                                                                                                                                            |
| 이미지 안 CLI                              | `OpenClaw 2026.9.2`                                                                                                                                                  |
| 컨테이너 기동                              | `docker run -d -p 127.0.0.1:18790:18789 openclaw-chris:local node openclaw.mjs gateway --allow-unconfigured --bind lan --auth token --token <생성값>` -> **healthy** |
| Windows 브라우저 접근                      | `http://127.0.0.1:18790/` **HTTP 200**                                                                                                                               |
| 이 포크의 커스터마이즈가 이미지에 반영됐나 | **예.** 컨테이너가 서빙한 `<title>` 이 `OpenClaw Control (Chris fork)`, mount-fallback 라벨이 `OpenClaw Control UI (Chris fork)`                                     |

주의 2가지.

- 컨테이너 안에서는 `--bind lan` 이 필요하다. 기본 `loopback` 이면 컨테이너 내부 127.0.0.1 에만 붙어서 포트 매핑이 닿지 않는다.
- 설정 없이 그냥 띄우면 `Missing config. Run 'openclaw setup' or set gateway.mode=local` 로 죽는다. 위처럼 `--allow-unconfigured` 를 주거나 마운트한 `.openclaw/` 에 설정을 넣어야 한다.

검증 후 컨테이너와 볼륨은 지웠고 이미지 `openclaw-chris:local` 만 남겼다.

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

| 경로                                        | 역할                                                                |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `FORK.md`                                   | 이 문서 (정본)                                                      |
| `chris-local/install.sh`                    | 격리된 로컬 인스턴스 설치 (멱등)                                    |
| `chris-local/gateway.sh`                    | start/stop/restart/status/logs                                      |
| `chris-local/oc-env.sh`                     | 격리 환경변수 (HOME/CONFIG/STATE/WORKSPACE + nvm)                   |
| `chris-local/oc`                            | 소스 빌드에 묶인 `openclaw` CLI 래퍼                                |
| `chris-local/openclaw-local.service`        | systemd user 유닛 템플릿 (`@NODE_BIN@` 치환)                        |
| `chris-local/CODEBASE.md` · `codebase.html` | 코드베이스 구조 문서 (백엔드·프런트·DB·인프라, 파일 경로 근거 포함) |
| `chris-local/BRANDING-AUDIT.md`             | 브랜딩 전수 조사 (바꾼 것·남긴 것·남은 흔적, 5장의 정본)            |
| `chris-local/BROWSER.md`                    | 브라우저 기능 (탐지 원인·Chrome 설치·설정 키·한글 폰트·Docker)      |
| `chris-local/FILE-PREVIEW.md`               | 문서 미리보기 (선택지 비교·구조·보안 경계·한글 폰트·되돌리기)       |
| `chris-local/workspace-pdf-rules.md`        | 에이전트 PDF 생성 규칙 원문 (`install-pdf-rules.sh` 가 설치)        |
| `src/brand.ts` · `ui/src/brand.ts`          | 브랜드 상수 정본과 Control UI 재수출                                |
| `ui/src/components/brand-mark.ts`           | 중립 브랜드 마크 (인라인 SVG)                                       |
| `ui/src/styles/fork-style.css`              | 포크 공통 스타일 계층 (full width · 라운드 5px)                     |

업스트림 파일 수정 범위는 5장(브랜딩)·5-A장(스타일)에 적혀 있다. 원칙은 같다: 새 파일을 만들고 기존 파일은 최소 줄만 고친다.

## IX-Auth 신원 연동 (2026-09-07)

포크에 사내 인증 서버 **IX-Auth** 를 신원 공급자로 붙였다. `gateway.auth.mode: "ix-auth"` 로만 켜지고, 기존 token/password/trusted-proxy 모드는 무영향이다.

| 문서                                                                   | 내용                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [chris-local/AUTH-IXAUTH.md](chris-local/AUTH-IXAUTH.md)               | **연동 정본.** 구조·시퀀스·설정 키·역할 매핑·운영 절차·되돌리기·라이브 검증 기록                   |
| [chris-local/AUTH-DEPARTMENTS.md](chris-local/AUTH-DEPARTMENTS.md)     | **부서 접근 강제 정본.** 규칙·역할 직교표·스키마와 승인 근거·강제 지점·동기화·운영 절차            |
| [chris-local/AUTH-SIGNUP.md](chris-local/AUTH-SIGNUP.md)               | **초대장·가입 플로우 정본.** 두 경로 시퀀스·설정 키·화면 목록·이메일 열거 방지·부서 접점·운영 절차 |
| [chris-local/DEPLOY.md](chris-local/DEPLOY.md)                         | **납품 설치 절차서.** 요구사항·`.env` 항목표·기동·백업·업그레이드·되돌리기·포트·라이선스 확인 항목 |
| [chris-local/AUTH-IXAUTH-OPTION.md](chris-local/AUTH-IXAUTH-OPTION.md) | 자체 구현안 대비 채택 근거 비교                                                                    |
| [chris-local/AUTH-PLAN.md](chris-local/AUTH-PLAN.md)                   | v2 결정 요약 + 폐기된 자체 구현 계획(부록)                                                         |
| [ix-auth/VENDOR.md](ix-auth/VENDOR.md)                                 | `ix-auth/` 벤더 복사본의 출처·제외 목록·재동기화·되돌리기                                          |
| [ix-auth/MODULE.md](ix-auth/MODULE.md)                                 | 포크가 수정해도 되는 구역, 지켜야 할 계약, 설계 불변식 준수 상태                                   |

`ix-auth/` 는 별도 제품 IX-Auth 의 벤더 복사본이다(원본 `D:\PROJECT\ix-auth` 커밋 `da66bda`). 포크의 oxfmt·oxlint·dup:check 는 이 트리를 건너뛰도록 설정돼 있다.

---

## 용어 설명

1. <a id="g1"></a>**게이트웨이** - 모든 요청이 먼저 닿는 앞단 서버. 이 포크에서는 화면·인증·에이전트 실행을 한꺼번에 맡는 본체를 가리킨다.
2. <a id="g2"></a>**토큰** - 신원을 증명하는 문자열. 가진 쪽은 그 신원으로 접속할 수 있으므로 비밀번호처럼 다룬다.
3. <a id="g3"></a>**멱등** - 같은 명령을 여러 번 실행해도 결과가 한 번 실행한 것과 같아지는 성질. 설치 스크립트를 다시 돌려도 안전하다는 뜻이다.
