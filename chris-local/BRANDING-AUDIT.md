# 브랜딩 전수 조사 (necromman/openclaw, chris/main)

작성 2026-09-06 (KST, 일요일). 기준 커밋 = 이 문서를 담은 커밋.

목적: 사용자에게 보이는 업스트림 제품명·마스코트 흔적을 전부 찾아 없애고, 무엇을 왜 남겼는지 근거를 남긴다. 기능은 하나도 제거하지 않았다.

정본 상수 = `src/brand.ts`. Control UI 는 `ui/src/brand.ts` 가 그대로 재수출한다.

이름을 바꾸려면 `src/brand.ts` 의 `BRAND_NAME` 한 줄만 고치면 된다 (현재 임시값 "Chris Agent").

---

## 1. 조사 방법 (그대로 재현 가능)

```bash
# 표시 문자열 후보 (대문자 O·C 로 시작하는 표기만 = 식별자 소문자 openclaw 는 제외)
rg -n "OpenClaw|ClawHub|Clawd|Lobster|lobster|🦞" ui/src src apps extensions skills

# i18n 카탈로그
rg -n "OpenClaw|ClawHub" ui/src/i18n/locales/
rg -c "OpenClaw" ui/src/i18n/.i18n/*.tm.jsonl      # 20개 언어 번역 메모리

# 이미지·아이콘
ls ui/public/*.svg ui/public/*.png ui/public/*.ico ui/public/app-art ui/public/community-art

# 남은 것 확인 (빌드 산출물)
rg -i "openclaw" dist/control-ui --glob '!*.map' -c
```

키(식별자)까지 치환하지 않도록 **문자열 값만** 바꾼다. 한 번 실수해서 `searchClawHub` 같은 키 12개가 깨졌고(`bcfbec8`) 바로 되돌렸다. 다음에 스크립트를 쓸 때는 `^\s*<식별자>\s*:` 패턴을 먼저 제외하고 시작한다.

---

## 2. 바꾼 것

### 2-1. 브랜드 상수 모듈 (신규)

| 파일                              | 역할                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/brand.ts`                    | 정본. `BRAND_NAME`·`BRAND_SHORT_NAME`·`BRAND_TAGLINE`·`BRAND_CLI_TAGLINE`·`BRAND_BANNER_EMOJI`·`BRAND_LINKS`·`BRAND_SKILL_HUB_NAME`·`BRAND_CLOUD_NAME`·`BRAND_PLACEHOLDERS` |
| `ui/src/brand.ts`                 | 위 파일 재수출 (Control UI 번들용). `tsconfig.ui.json` include 에 `src/brand.ts` 추가                                                                                       |
| `ui/src/components/brand-mark.ts` | 중립 인라인 SVG 마크 (favicon 과 같은 도형)                                                                                                                                 |
| `ui/src/styles/fork-style.css`    | 포크 공통 스타일 계층 (레이아웃·라운드, 아래 4장)                                                                                                                           |

`t()` 와 wizard `interpolate()` 를 한 줄씩 고쳐 `{brand}`·`{brandShort}`·`{brandSkillHub}`·`{brandCloud}` 플레이스홀더를 **항상** 주입한다. 덕분에 카탈로그 문자열만 고치면 되고 호출부 수백 곳을 안 건드린다.

### 2-2. Control UI 문자열

| 대상                      | 파일                                                                                                  | 건수 | 조치                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| 제품명                    | `ui/src/i18n/locales/en*.ts` (9개)                                                                    | 78   | `{brand}`                                                                               |
| 스킬 허브 표기            | 같음                                                                                                  | 28   | `{brandSkillHub}` (= "Skill Hub", 기능·URL 그대로)                                      |
| 마스코트 문구             | `en.ts` (Lobster visits·Lobsterdex·Clawd·Claw red 등)                                                 | 10   | 중립어 (Mascot visits / Mascot gallery / Say hello / Red)                               |
| 번역 메모리               | `ui/src/i18n/.i18n/*.tm.jsonl` (20개 언어)                                                            | 1782 | source·hash·translated 동시 갱신 → 번역 유실 0건                                        |
| 정적 셸                   | `ui/index.html`                                                                                       | 5    | 중립 문구. 타이틀은 빌드가 스탬프                                                       |
| PWA 매니페스트            | `ui/public/manifest.webmanifest`                                                                      | 3    | 빌드가 `BRAND_NAME` 으로 스탬프 (`ui/vite.config.ts` writeBundle)                       |
| 탭 타이틀 접미사          | `ui/src/app-navigation.ts` `formatDocumentTitle()`                                                    | 1    | `BRAND_NAME` (단언하던 테스트 4개도 상수 참조로 전환)                                   |
| 모바일 상단바             | `ui/src/components/app-topbar.ts`                                                                     | 2    | `BRAND_NAME`                                                                            |
| 연결/로그인 화면          | `ui/src/components/login-gate.ts`                                                                     | 2    | `BRAND_NAME`                                                                            |
| 프로필 배지               | `ui/src/pages/profile/profile-hero.ts`                                                                | 1    | `BRAND_NAME`                                                                            |
| 채팅 어시스턴트 기본 이름 | `chat-composer.ts` · `session-menu-navigation.ts`                                                     | 2    | `BRAND_NAME`                                                                            |
| 런타임 라벨               | `chat-model-picker-options.ts`                                                                        | 1    | `BRAND_NAME`                                                                            |
| About 링크표              | `ui/src/pages/about/view.ts`                                                                          | 6    | `BRAND_LINKS` 참조 + 빈 값이면 렌더 안 함 (웹사이트·Discord·X 는 이 포크에 없어 숨겨짐) |
| 커뮤니티 URL              | `ui/src/lib/product-links.ts` · `app-sidebar-agent-menu.ts` · `app-sidebar.ts` · `pages/apps/view.ts` | 5    | `BRAND_LINKS.discord` (빈 값 → 메뉴 행·초대 카드 자체가 안 뜸)                          |
| 스킬 허브 URL             | `ui/src/lib/plugins/index.ts`                                                                         | 1    | `BRAND_LINKS.skillHub` (URL 은 동일, 라벨만 중립)                                       |

### 2-3. 이미지·아이콘

| 파일                                                                | 이전                       | 지금                                                                                   |
| ------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `ui/public/favicon.svg`                                             | 애니메이션 로브스터 (SMIL) | 중립 기하 마크 (둥근 판 + 링 + "C" 아크), 인라인 SVG                                   |
| `ui/public/favicon-32.png` · `favicon.ico` · `apple-touch-icon.png` | 로브스터 래스터            | 같은 마크를 Pillow 로 래스터 (16/32/48/64/128 멀티 ICO)                                |
| `ui/src/components/icons-tools.ts` `lobster` 아이콘                 | 빨간 로브스터              | 같은 마크. **키 이름은 식별자라 유지** (네비게이션·커맨드 팔레트·프로필 히어로가 참조) |
| About 히어로                                                        | 크림슨 Clawd 렌더          | `renderBrandMark()`                                                                    |
| 어시스턴트 아바타                                                   | `favicon.svg` 참조         | 자동으로 새 마크 (`custodian-surface.ts` 는 무수정)                                    |

파비콘 생성은 SVG 래스터라이저 없이 Pillow 로 같은 좌표계(120x120)를 다시 그리는 방식이다.

재생성 스크립트는 스크래치패드에만 있으므로, 마크를 바꾸면 `ui/public/favicon.svg` 를 고치고 같은 도형을 PNG 로 다시 그려야 한다.

### 2-4. CLI·에이전트

| 대상                     | 파일                                                                 | 조치                                                                                                  |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 배너 제목                | `src/cli/banner.ts`                                                  | `BRAND_NAME`, 이모지 접두 제거 (`BRAND_BANNER_EMOJI = ""`)                                            |
| 배너 ASCII 마스코트      | `src/cli/banner.ts` `resolveLobsterArt()`                            | 항상 `null` (배너 자체는 유지)                                                                        |
| `--version`              | `src/entry.version-fast-path.ts`                                     | `${BRAND_NAME} ${VERSION}`                                                                            |
| 기본 태그라인            | `src/cli/tagline.ts`                                                 | `BRAND_CLI_TAGLINE`                                                                                   |
| doctor 인트로            | `src/flows/doctor-health.ts`                                         | `${BRAND_NAME} doctor`                                                                                |
| 런타임 오류 제목         | `src/index.ts`                                                       | `BRAND_NAME`                                                                                          |
| 웹푸시 알림 제목 5종     | `src/gateway/event-web-push.ts`                                      | `BRAND_NAME`                                                                                          |
| ACP 게이트웨이 표시명    | `src/acp/types.ts`                                                   | `BRAND_NAME` (프로토콜 id `openclaw-acp` 는 유지)                                                     |
| 시스템 프롬프트 페르소나 | `src/agents/system-prompt.ts` · `prompt-surface.ts`                  | "You are a personal assistant running inside ${BRAND_NAME}." 외 10건                                  |
| 설치 마법사              | `src/wizard/i18n/locales/{en,zh-CN,zh-TW}.ts`                        | 85건 `{brand}`                                                                                        |
| 플러그인 카탈로그 설명   | `extensions/*/package.json` · `openclaw.plugin.json` · 시드 카탈로그 | 199건 중립화 + 렌더 시점 `neutralizeCatalogCopy()`                                                    |
| 업데이트 알림 7종        | `src/infra/update-run-report.ts` · `src/cli/update-cli/status.ts`    | `BRAND_NAME`                                                                                          |
| 음성 도구 오류 6건       | `ui/src/pages/chat/realtime-talk-shared.ts`                          | `BRAND_NAME`                                                                                          |
| 런처 `--version`         | `openclaw.mjs`                                                       | 리터럴 1개(모듈 그래프 로드 전이라 import 불가). `src/brand.test.ts` 가 `BRAND_NAME` 과 동기화를 단언 |

---

## 3. 일부러 남긴 것

### 3-1. 내부 식별자 (바꾸면 업스트림 동기화가 깨진다)

| 종류                       | 예                                                                           |
| -------------------------- | ---------------------------------------------------------------------------- |
| npm 패키지명               | `openclaw`, `@openclaw/*` 워크스페이스 패키지 전부                           |
| CLI 실행파일·하위 명령     | `openclaw`, `openclaw doctor`, `openclaw update`, `openclaw devices approve` |
| 설정 디렉터리·키·환경변수  | `~/.openclaw`, `openclaw.control.settings.v1`, `openclaw.i18n.locale`        |
| 커스텀 엘리먼트·CSS 클래스 | `<openclaw-app>`, `openclaw-tooltip`, `.clawhub-skill-icon`                  |
| 라우트·API·플러그인 ID     | `/settings/lobsterdex`, `/__openclaw__/link-favicon`, `clawhub:<pkg>`        |
| i18n 키                    | `askOpenClaw`, `searchClawHub`, `lobsterdex`, `themes.claw`                  |
| 코드 심볼                  | `OpenClawConfig`, `buildOpenClawToolFallbackText`, `LobsterPetLook`          |
| 서비스·작업 이름           | `OpenClaw Gateway` systemd/schtasks Description (실행 중 유닛을 찾는 키)     |
| MCP 클라이언트 신원        | `mcp-app-view.ts` 의 `{ name: "OpenClaw" }` (서버에 보내는 프로토콜 값)      |
| 외부 서비스 카탈로그 표기  | ClickClack 통합 이름 "OpenClaw", `signal-cli link -n "OpenClaw"`             |

문서에서는 이것들을 **"내부 이름"** 으로 안내한다. 사용자에게는 CLI 를 `openclaw` 로 치라고 하되 제품 이름은 브랜드 이름으로 부른다.

### 3-2. 라이선스 고지 (MIT 조건)

- `LICENSE`, `THIRD_PARTY_NOTICES.md`, 소스 파일 상단 저작권 주석: **원문 그대로**.
- About 페이지 하단 `aboutPage.license` = "© 2026 OpenClaw Foundation - MIT License." 도 **그대로 남긴다.** 브랜드가 바뀌어도 업스트림 저작권 귀속은 사실이고, 이걸 지우는 것이 화이트라벨의 목적이 아니다.
- 설치 마법사의 "by the OpenClaw Foundation (a non-profit)" 문장도 같은 이유로 유지.

### 3-3. 업스트림 문서

`CHANGELOG.md`, `docs/`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `VISION.md` 는 내부 문서라 손대지 않는다.

Control UI 안의 `docs.openclaw.ai` 딥링크(약 60개, "자세히 알아보기" 류)도 **기능**이다.

그 문서는 이 포크에도 그대로 적용되므로 링크를 없애면 도움말이 사라진다. About 의 대표 링크만 포크 저장소로 바꿨다.

---

## 4. 남은 흔적 (알고 남긴 것)

| 항목                      | 위치                                                 | 왜 남았나 / 다음 수                                                                                                                                          |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 마스코트 펫 스프라이트    | `ui/src/components/lobster-pet-*.ts` (약 5,800줄)    | 사이드바를 돌아다니는 로브스터 이스터에그. **기본값을 꺼짐으로 바꿔**(`app-shell-view.ts`) 켜지 않으면 보이지 않는다. 아트 자체를 다시 그리는 것은 별도 작업 |
| 마스코트 갤러리 페이지    | `ui/src/pages/lobsterdex/`                           | 설정 > 화면 설정에서 "Mascot gallery" 로 진입하면 팔레트별 로브스터가 그려진다. 라벨은 중립화, 그림은 그대로                                                 |
| 메모리 dreaming 삽화      | `ui/src/pages/agents/memory/view.ts`                 | 자는 로브스터 1개                                                                                                                                            |
| 화면 설정 팔레트 미리보기 | `ui/src/pages/config/view-appearance-preferences.ts` | 팔레트 선택 UI 가 로브스터로 색을 보여준다                                                                                                                   |
| 플랫폼 아트               | `ui/public/app-art/*.webp` (18개)                    | 앱 페이지 카드 배경. 업스트림 앱 스크린샷이라 자체 제작 이미지가 필요                                                                                        |
| 커뮤니티 초대 아트        | `ui/public/community-art/discord-invite.webp`        | 초대 카드는 URL 이 비어 렌더되지 않으므로 화면에는 안 나온다                                                                                                 |
| `apps/` 네이티브 아이콘   | `apps/ios`·`apps/android`·`apps/macos` 리소스        | 아래 5장 참조. 이번 작업 범위 밖                                                                                                                             |

---

## 5. 네이티브 앱 아이콘 교체 방법 (미실시)

Control UI·CLI 를 먼저 끝냈고 네이티브 앱 리소스는 위치만 기록한다.

| 플랫폼            | 경로                                                            | 교체 방법                                                                                           |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| iOS / macOS       | `apps/*/Assets.xcassets/AppIcon.appiconset/`                    | `Contents.json` 이 요구하는 크기별 PNG 를 같은 마크로 다시 만들어 덮어쓴다                          |
| Android / Wear OS | `apps/android/**/res/mipmap-*/` + `res/drawable/` 적응형 아이콘 | `ic_launcher_foreground.xml` 을 브랜드 마크 벡터로 교체, `ic_launcher_background` 색을 `#1b2029` 로 |
| Chrome 확장       | `apps/chrome-extension/` manifest `icons`                       | 16/32/48/128 PNG                                                                                    |

전부 `ui/public/favicon.svg` 와 같은 도형을 쓰면 시각적으로 한 벌이 된다.

---

## 6. 검증

- `pnpm ui:i18n:verify` 통과 (키 6,358)
- `pnpm build` 통과 (Control UI 번들 예산 한도 내)
- `pnpm check` 통과 (typecheck prod/scripts/test-root, lint, format)
- WSL `~/openclaw` 자동 배포 후 `http://127.0.0.1:18789/` 실측
- 스크린샷: `chris-server/analysis/2026-09-06-openclaw-2/`

### 6-1. 화면 실측 (DOM 텍스트 + 속성 스캔)

| 화면                                    | 탭 제목                | "OpenClaw" 표시 문자열                                              | 빨간 마스코트 |
| --------------------------------------- | ---------------------- | ------------------------------------------------------------------- | ------------- |
| 연결/로그인 (`brand-03-connect.png`)    | Chris Agent Control    | 0 (환경변수명 `OPENCLAW_GATEWAY_TOKEN` 과 `openclaw` CLI 명령 제외) | 없음          |
| 홈/채팅 (`brand-01-home.png`)           | main - Chris Agent     | 0                                                                   | 없음          |
| 설정 > 정보 (`brand-02-about.png`)      | 정보 - Chris Agent     | 1 = MIT 라이선스 고지 (의도)                                        | 없음          |
| 플러그인 (`layout-02-plugins-1440.png`) | 플러그인 - Chris Agent | 0 (`@openclaw/*` 패키지명 제외)                                     | 없음          |

파비콘은 `/favicon.svg` = 중립 마크. 사이드바 커스토디언 아이콘, 어시스턴트 아바타, About 히어로 모두 같은 마크다.

### 6-2. 빌드 산출물 잔존 문자열 분류

`dist/control-ui` 에서 `OpenClaw`(대문자 표기) 165건. 전부 식별자·법적 고지·개발자 콘솔이다.

| 분류               | 건수 | 예                                                                     |
| ------------------ | ---- | ---------------------------------------------------------------------- |
| i18n **키** 이름   | 49   | `askOpenClaw`, `openInOpenClaw` (값은 `{brand}`)                       |
| 코드 식별자        | 92   | `includeInOpenClawGroup`, `icon:"lobster"`, 도구 그룹 `group:openclaw` |
| MIT 라이선스 고지  | 19   | 로케일별 "© 2026 OpenClaw Foundation - MIT ..."                        |
| 중립화 정규식 원문 | 3    | `neutralizeCatalogCopy()` 안의 `/OpenClaw/` 패턴                       |
| 개발자 콘솔 경고   | 2    | `console.warn("OpenClaw service worker registration failed.")`         |

```bash
cd dist/control-ui
grep -roh "OpenClaw" --include="*.js" --include="*.html" --include="*.webmanifest" . | wc -l
```

### 6-3. 원격 카탈로그는 표시 시점에 중립화

공식 플러그인 카탈로그 설명은 npm 레지스트리에서 받아 `state/openclaw.sqlite` 의 `official_external_plugin_catalog_snapshots` 에 캐시된다. 포크가 원본을 못 고치므로 `ui/src/lib/plugins/index.ts` 의 `neutralizeCatalogCopy()` 가 렌더 직전에 제품명을 걷어낸다. 로컬 매니페스트(`extensions/*/openclaw.plugin.json` 50건, `package.json` 149건)도 함께 고쳤다.
