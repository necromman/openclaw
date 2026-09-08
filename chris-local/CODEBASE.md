# CODEBASE.md - OpenClaw 코드베이스 구조 (개발자용)

> **어디가 백엔드고 어디가 프런트인지, 인프라는 무엇이 필요한지, 데이터베이스는 무엇을 쓰는지**를 코드로 직접 확인해 정리한 문서다.
>
> 모든 주장에 파일 경로(가능하면 줄 번호)를 붙였다. 추측은 넣지 않았고, 확인하지 못한 것은 그렇게 적었다.

- 대상: 포크 `necromman/openclaw` 브랜치 `chris/main` (업스트림 `openclaw/openclaw` v2026.9.2 기준)
- 편집 체크아웃: `D:\PROJECT\openclaw` / 빌드·실행 정본: WSL `~/openclaw`
- 작성 2026-09-06 (KST, 일요일). 운영·설치·동기화 절차는 [FORK.md](../FORK.md) 가 정본이고, 이 문서는 **코드 구조** 만 다룬다.
- HTML 판: [codebase.html](codebase.html)

---

## 0. 30초 요약

| 질문                         | 답                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **백엔드는 어디인가**        | `src/` 하나. TypeScript 16,626 파일. HTTP 는 `node:http` 원본, WS 는 `ws` 라이브러리. Express·Hono·Fastify 를 코어에 쓰지 않는다(Express 는 3개 플러그인 전용). 게이트웨이 프로세스 **하나**가 전부를 들고 있다 |
| **프런트는 어디인가**        | `ui/` (Control UI, **Lit 3 + Vite 8**, 21개 로케일) 가 주 표면. `apps/` 에 네이티브 앱 6종(Swift·Kotlin·Rust). 그 밖에 TUI(`src/tui`), Telegram Mini App(`extensions/telegram/src/miniapp`)                     |
| **DB 는 무엇인가**           | **SQLite 전용.** 드라이버는 Node 내장 `node:sqlite` (`DatabaseSync`) 하나. better-sqlite3·libsql 없음. Postgres·MySQL·Redis **없음**. 쿼리 빌더 Kysely 는 컴파일 전용                                           |
| **인프라는 무엇이 필요한가** | Node 22.22.3+/24.15+/25.9+ 와 pnpm 12.1.0 만. 필수 외부 서비스 0. 기본 포트 18789 단일. Docker 이미지 실측 4.37GB (그중 node_modules 2.65GB)                                                                    |

---

## 1. 저장소 지도

### 1-1. 최상위 (depth 1)

```
openclaw/
├── src/                 백엔드 전부 (게이트웨이·CLI·에이전트·채널·상태). TS 16,626 파일 / 78 하위 디렉터리
├── ui/                  Control UI (Lit 3 + Vite 8). 빌드 산출물은 루트 dist/control-ui/
├── packages/            내부 워크스페이스 패키지 23개 (@openclaw/*)
├── extensions/          플러그인 153개 (채널·모델 프로바이더·도구·메모리·인프라)
├── apps/                네이티브 앱 (android/ios/macos/linux/swabble/shared/macos-mlx-tts/mobile)
├── skills/              번들 스킬 51개 (SKILL.md 디렉터리)
├── custodian-skills/    커스토디언 스킬 4개
├── scripts/             빌드·검사·릴리스 오케스트레이션 (.mts/.mjs)
├── test/                vitest 프로젝트 매트릭스 (test/vitest/*.config.ts 118개)
├── docs/                제품 문서 751개 (.md/.mdx)
├── config/              린트·타입·베이스라인 설정 모음
├── examples/            외부 소비자 예제 (ai-chat)
├── deploy/ qa/ security/ patches/ git-hooks/
├── Dockerfile           멀티스테이지 (node:24-bookworm 빌드 -> bookworm-slim 런타임)
├── docker-compose.yml   gateway + cli 2 서비스
├── package.json         루트 겸 메인 패키지 (스크립트 700개 이상)
├── pnpm-workspace.yaml  워크스페이스 정의
├── openclaw.mjs         CLI 런처 (bin)
├── AGENTS.md            기여자 규칙 정본 (362줄). CLAUDE.md 는 이것의 심링크
├── FORK.md              이 포크의 운영 정본
└── chris-local/         이 포크가 추가한 설치·운영 스크립트 + 이 문서
```

근거: `ls` 실측, `find src -name "*.ts" | wc -l` = 16626, `ls -d extensions/*/ | wc -l` = 153, `ls skills | wc -l` = 52(그중 `pyproject.toml` 파일 1개 제외 = 51 디렉터리), `find docs -name "*.md" -o -name "*.mdx" | wc -l` = 751.

### 1-2. 워크스페이스 패키지 전수 (23개)

`pnpm-workspace.yaml:1-6` 은 `.`(루트) · `ui` · `packages/*` · `extensions/*` · `examples/*` 를 워크스페이스로 잡는다. `packages/` 는 다음과 같다. 전부 TypeScript 다.

| 경로                                   | 패키지명                               | 역할                                                                               |
| -------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/acp-core/`                   | `@openclaw/acp-core`                   | ACP(Agent Client Protocol) 공통 타입                                               |
| `packages/agent-core/`                 | `@openclaw/agent-core`                 | 에이전트 런타임 공통 계약                                                          |
| `packages/ai/`                         | `@openclaw/ai`                         | 모델 프로바이더 어댑터 + 스트리밍 런타임 (외부 공개용)                             |
| `packages/gateway-client/`             | `@openclaw/gateway-client`             | 게이트웨이 WebSocket 레퍼런스 클라이언트 (`browser` 서브패스를 Control UI 가 쓴다) |
| `packages/gateway-protocol/`           | `@openclaw/gateway-protocol`           | 프로토콜 스키마·런타임 검증기. `src/version.ts:2` `PROTOCOL_VERSION = 4`           |
| `packages/llm-core/`                   | `@openclaw/llm-core`                   | LLM 와이어 계약 (Api·Provider·Transport·ProviderResponse)                          |
| `packages/markdown-core/`              | `@openclaw/markdown-core`              | 마크다운·frontmatter 파서                                                          |
| `packages/media-core/`                 | `@openclaw/media-core`                 | 미디어 공통                                                                        |
| `packages/media-generation-core/`      | `@openclaw/media-generation-core`      | 이미지·비디오·음악 생성 공통                                                       |
| `packages/media-understanding-common/` | `@openclaw/media-understanding-common` | 미디어 이해 공통                                                                   |
| `packages/memory-host-sdk/`            | `@openclaw/memory-host-sdk`            | 메모리 호스트 SDK. FTS5·sqlite-vec 스키마와 임베딩 클라이언트가 여기 있다          |
| `packages/mermaid-renderer/`           | `@openclaw/mermaid-renderer`           | mermaid 렌더러                                                                     |
| `packages/model-catalog-core/`         | `@openclaw/model-catalog-core`         | 모델 카탈로그 타입·정규화                                                          |
| `packages/net-policy/`                 | `@openclaw/net-policy`                 | 네트워크 정책(SSRF 등)                                                             |
| `packages/normalization-core/`         | `@openclaw/normalization-core`         | 문자열·값 정규화                                                                   |
| `packages/plugin-package-contract/`    | `@openclaw/plugin-package-contract`    | 외부 플러그인 package.json 필수 필드 검증                                          |
| `packages/plugin-sdk/`                 | `@openclaw/plugin-sdk`                 | **플러그인 SDK 공개 표면** (`src/plugin-sdk` 재수출 파사드)                        |
| `packages/retry/`                      | `@openclaw/retry`                      | 재시도 유틸                                                                        |
| `packages/sdk/`                        | `@openclaw/sdk`                        | 외부 SDK                                                                           |
| `packages/session-url-contract/`       | `@openclaw/session-url-contract`       | 세션 URL 계약                                                                      |
| `packages/terminal-core/`              | `@openclaw/terminal-core`              | 터미널 공통                                                                        |
| `packages/tool-call-repair/`           | `@openclaw/tool-call-repair`           | 툴콜 복구                                                                          |
| `packages/workboard-contract/`         | `@openclaw/workboard-contract`         | 워크보드 계약                                                                      |

그 밖의 워크스페이스 멤버: `ui` (`openclaw-control-ui`), `examples/ai-chat` (`@openclaw/example-ai-chat`), 그리고 `extensions/*` 153개.

---

## 2. 백엔드

### 2-1. 진입점 체인

```
openclaw (bin)  =  openclaw.mjs
   ├─ Node 버전 게이트 (>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0)
   ├─ compile-cache respawn 감독 (자식 spawn + 시그널 포워딩)
   └─ import("./dist/entry.js")   ->  src/entry.ts  ->  src/cli/*  ->  gateway 명령
                                                                       └─ src/gateway/server.ts
                                                                            startGatewayServer(port = 18789)
```

- `package.json` `bin` = `openclaw.mjs`. 런처는 순수 `.mjs` 라 빌드 없이도 돈다.
- Node 버전 검사: `openclaw.mjs` `ensureSupportedRuntimeVersion()`. Bun 은 `node:sqlite` 를 제공하는 빌드만 통과시킨다(같은 함수).
- **respawn 감독자**가 런처 안에 있다: `runRespawnedChild()` 가 자식을 `spawn` 하고 SIGTERM/SIGINT/SIGHUP/SIGQUIT(Windows 는 SIGBREAK)를 전달한 뒤, 1초 유예 -> 강제 kill -> 1초 후 하드 exit 순으로 내려간다. 같은 로직의 TS 판이 `src/entry.compile-cache.ts` 에 있다(런처 주석이 그렇게 명시한다).
- TS 진입점: `src/entry.ts` (CLI 부트스트랩), `src/index.ts` (패키지 실행 진입점, `dist/index.js`).
- 게이트웨이 시작: `src/gateway/server.ts:29-36` `startGatewayServer(port = 18789, opts)` -> 동적 import 로 `server-start.js` 를 늦게 로드한다(가벼운 호출자가 전체 의존 그래프를 안 물게 하려고). 기본 포트 상수는 `src/config/paths.ts:406` `DEFAULT_GATEWAY_PORT = 18789`.

### 2-2. `src/` 디렉터리 지도

78개 하위 디렉터리 중 규모 상위와 역할이 뚜렷한 것들이다(괄호 = 그 디렉터리의 `.ts` 파일 수, 테스트 포함).

| 디렉터리           | 파일 수 | 역할                                                                                                                    |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/agents/`      | 3,342   | 에이전트 런타임 본체. 하네스(`harness/`), 임베디드 러너, 서브에이전트, 샌드박스, 워크트리, 인증 프로필, 시스템 프롬프트 |
| `src/gateway/`     | 2,538   | **게이트웨이 서버.** HTTP/WS 리스너, 인증, RPC 메서드 312개(`server-methods/`), 채널 런타임, 워커 배치, 리로드·재시작   |
| `src/infra/`       | 1,429   | 인프라 유틸. SQLite 로더·WAL·무결성, Ed25519 서명·기기 아이덴티티, 상태 마이그레이션, ClawHub 클라이언트                |
| `src/commands/`    | 1,086   | 슬래시/봇 명령 구현                                                                                                     |
| `src/plugins/`     | 1,031   | 플러그인 로더·레지스트리·매니페스트·API 타입                                                                            |
| `src/auto-reply/`  | 805     | 자동 응답 파이프라인                                                                                                    |
| `src/cli/`         | 795     | CLI 명령 트리 (`gateway-cli/`, `daemon-cli/`, `node-cli/` 등)                                                           |
| `src/config/`      | 790     | 설정 스키마·로드·검증·경로 해석 (`paths.ts`), 세션 접근자                                                               |
| `src/plugin-sdk/`  | 664     | 플러그인 SDK **구현부** (packages/plugin-sdk 가 이걸 재수출)                                                            |
| `src/channels/`    | 486     | 채널 추상화. `plugins/types.plugin.ts` 가 채널 인터페이스 정본                                                          |
| `src/cron/`        | 398     | 예약 작업                                                                                                               |
| `src/skills/`      | 253     | 스킬 로더·라이프사이클·보안·워크숍                                                                                      |
| `src/state/`       | 171     | **DB 스키마·마이그레이션 정본** (`*.sql`, `*-db.ts`)                                                                    |
| `src/node-host/`   | 136     | 원격 노드(다른 기기) 호스트                                                                                             |
| `src/daemon/`      | 123     | 데몬/서비스 실행                                                                                                        |
| `src/tui/`         | 122     | 터미널 UI                                                                                                               |
| `src/acp/`         | 126     | ACP 클라이언트·서버·이벤트 매퍼                                                                                         |
| `src/hooks/`       | 77      | 훅 시스템(내부 훅 + HOOK.md 파일 훅) + Gmail 워처                                                                       |
| `src/sessions/`    | 77      | 세션 정책·상태 투영                                                                                                     |
| `src/worker/`      | 65      | 워커 런타임(브라우저·컴퓨터·임베디드 에이전트)                                                                          |
| `src/pairing/`     | 16      | 기기 페어링 코드·챌린지·스토어                                                                                          |
| `src/transcripts/` | 22      | 전사 저장소(SQLite)                                                                                                     |
| `src/memory/`      | 3       | **얇다.** 메모리 본체는 `extensions/memory-core` + `packages/memory-host-sdk` 에 있다                                   |

### 2-3. HTTP/WS 서버는 무엇으로 띄우나

**프레임워크를 쓰지 않는다.** Node 표준 모듈 + `ws` 조합이다.

| 요소         | 코드                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP 서버    | `src/gateway/server-http.ts:4-9` - `node:http` 의 `createServer`, TLS 는 `node:https` 의 `createServer`                                                                               |
| WebSocket    | `src/gateway/server-runtime-state.ts:58` 가 `ws` 를 `require` 하고, `:300-303` 에서 `new NpmWebSocketServer({ noServer: true })` 로 만든 뒤 HTTP upgrade 핸들러에 붙인다              |
| upgrade 처리 | `src/gateway/server-http-upgrades.ts`                                                                                                                                                 |
| 의존성       | 루트 `package.json` `dependencies` 에 `ws 8.21.3`. **Hono·Fastify 없음**                                                                                                              |
| Express      | 루트에 `express 5.2.1` 이 있지만 **코어가 아니라 플러그인 3개 전용**: `extensions/browser/src/server.ts:4`, `extensions/line/src/webhook.ts:3`, `extensions/msteams/src/monitor.ts:3` |

**HTTP 라우트 계약** (`src/gateway/gateway-http-route-contracts.ts:1-15`):

| 경로                                                                                             | 용도                                   |
| ------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `/health`, `/healthz`                                                                            | liveness                               |
| `/ready`, `/readyz`                                                                              | 채널 인지 readiness                    |
| `/startup`, `/startupz`                                                                          | 트래픽 수용 시작 판정                  |
| `/__openclaw__/worker`                                                                           | 워커 게이트웨이                        |
| `/__openclaw__/worker-bundle`, `/__openclaw__/worker-transfer`, `/__openclaw__/worker-bootstrap` | 워커 번들·워크스페이스·부트스트랩 전송 |
| `/__openclaw__/mcp-app`, `.../view`                                                              | MCP 앱 샌드박스 셸/뷰                  |
| 그 밖의 GET                                                                                      | Control UI 정적 서빙 (2-9 참조)        |

Dockerfile `435-436` 이 이 프로브를 그대로 HEALTHCHECK 로 쓴다.

**RPC 표면**은 WebSocket 위의 메서드 카탈로그다. `src/gateway/server-methods-list.ts:36-40` `listGatewayMethods()` 가 코어 메서드(`methods/core-descriptors.ts`) + 보조 메서드(`server-aux-methods.ts`) + 로드된 채널 플러그인이 등록한 메서드를 합쳐 광고한다. 구현체는 `src/gateway/server-methods/` 에 312개 파일로 흩어져 있다.

### 2-4. 프로토콜 패키지

- `packages/gateway-protocol/src/version.ts:2-8` - `PROTOCOL_VERSION = 4`, `MIN_CLIENT_PROTOCOL_VERSION = 4`, `MIN_NODE_PROTOCOL_VERSION = 3`, `MIN_PROBE_PROTOCOL_VERSION = 3`.
- 스키마·프레임 가드: `packages/gateway-protocol/src/public-schema.ts`, `frame-guards.ts`, `connect-error-details.ts`.
- 네이티브 앱은 같은 상수에 잠겨 있다: `packages/gateway-protocol/src/native-protocol-levels.guard.test.ts:132-175` 가 Swift·Kotlin 쪽 `GATEWAY_PROTOCOL_VERSION` 이 일치하는지 단언한다. **프로토콜을 바꾸면 이 가드가 먼저 깨진다.**
- 레퍼런스 클라이언트: `packages/gateway-client/src/` - `protocol-client.ts`, `connect-auth.ts`, `device-auth.ts`, `reconnect-policy.ts`, `scope-upgrade.ts`, `session-projection.ts`.

### 2-5. 인증 - 토큰과 Ed25519 기기 페어링

두 층이다.

**(1) 게이트웨이 토큰/패스워드.** `src/gateway/auth.ts` 와 `auth-mode-policy.ts` · `auth-rate-limit.ts` · `auth-token-resolution.ts` · `auth-surface-resolution.ts`. 토큰은 `OPENCLAW_GATEWAY_TOKEN` 또는 설정 `gateway.auth.token` 에서 온다(`.env.example` 의 "Gateway auth + paths" 절).

**(2) Ed25519 기기 아이덴티티 + 페어링.**

| 코드                                                        | 하는 일                                                                                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/infra/ed25519-signature.ts:87-98`                      | raw 키 <-> PEM 변환, `asymmetricKeyType !== "ed25519"` 거부                                                                                                 |
| `src/infra/device-identity-store.ts:83`                     | `crypto.generateKeyPairSync("ed25519")` 로 기기 키쌍 생성. `:100`, `:189` 에서 타입 재검증                                                                  |
| `src/infra/device-identity.ts`, `device-identity-legacy.ts` | 아이덴티티 로드/이관                                                                                                                                        |
| `src/infra/state-migrations.device-identity.ts:19`          | 기존 시드에서 Ed25519 키 파생                                                                                                                               |
| `src/pairing/`                                              | `join-code.ts`, `setup-code.ts`, `pairing-challenge.ts`, `pairing-store-sqlite.ts` - 페어링 코드 발급과 챌린지, SQLite 저장                                 |
| DB 테이블                                                   | `device_identities`, `device_auth_tokens`, `device_pairing_pending/paired/join_codes`, `device_bootstrap_tokens`, `gateway_origin_device_tokens` (5장 참조) |

같은 Ed25519 코드가 플러그인 카탈로그 서명 검증에도 쓰인다: `src/plugins/official-external-plugin-catalog-envelope.ts:207`.

### 2-6. 세션

세션은 **제어 평면(공용 DB)과 데이터 평면(에이전트별 DB)이 분리**돼 있다.

- 제어 평면(공용 `openclaw.sqlite`): `session_state_events`, `session_state_heads`, `session_watch_cursors`, `session_upstream_links`, `session_groups`, `state_leases`.
- 데이터 평면(에이전트별 `openclaw-agent.sqlite`): `session_nodes`, `session_participants`, `session_windows`, `session_conversations`, `session_members`, `conversations`, `conversation_deliveries`, `transcript_events` 등.
- 코드: `src/sessions/` (정책·투영), `src/config/sessions/` (접근자, 아카이브 워커 `session-accessor.sqlite-archive.worker.ts`), `src/transcripts/store-sqlite.ts` (전사 저장).
- 게이트웨이 쪽: `src/gateway/server-session-events.ts`, `server-session-key.ts`, `server-node-session-runtime.ts`.

### 2-7. 에이전트 런타임 - 하네스 구조

**하네스(harness) = "이 턴을 실제로 돌리는 실행기"** 다. 두 종류가 공존한다.

```
AgentRuntimeConfig  (src/config/types.agents.ts:30-37)
   ├─ { type: "embedded" }        -> 내장 OpenClaw 하네스
   └─ { type: "acp", acp: {...} } -> ACP 로 외부 에이전트에 위임 (agent: "codex" | "claude" | ...)
```

| 요소                 | 코드                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 내장 하네스          | `src/agents/harness/builtin-openclaw.ts` - `runEmbeddedAttempt`(`src/agents/embedded-agent-runner/run/attempt.ts`)를 `AgentHarness` 계약으로 감싼다                                                             |
| 하네스 레지스트리    | `src/agents/harness/registry.ts:38-47` `registerAgentHarness()`. **id `"openclaw"` 는 내장 런타임 전용으로 예약**돼 있어 플러그인이 못 쓴다(`:46-48` 에서 throw)                                                |
| 네이티브 압축 소유자 | `registry.ts:23` `CODEX_NATIVE_COMPACTION_OWNER_ID = "codex"` - 네이티브 compaction 은 레지스트리 소유 Codex 하네스만 가능(`:49-54`)                                                                            |
| 하네스 플러그인      | `extensions/codex/index.ts:228`, `extensions/copilot/index.ts:48` 이 `api.registerAgentHarness` 를 호출한다                                                                                                     |
| ACP 계층             | `src/acp/` - `client.ts`, `server.ts`, `event-mapper.ts`, `translator.*.ts`, `permission-relay.ts`, `event-ledger.ts`. 어댑터 id 는 설정의 `agents.<id>.runtime.acp.agent` (`src/config/types.agents.ts:20-28`) |
| 하네스 계약 타입     | `src/agents/harness/types.ts` (`AgentHarness`, `AgentHarnessV2`, `AgentHarnessSupportContext` 등), 정책 `policy.ts:17`, 호스트 능력 `host-capability-types.ts:33`                                               |
| 훅 컨텍스트          | `src/agents/harness/hook-context.ts:19`                                                                                                                                                                         |
| 네이티브 훅 릴레이   | `src/agents/harness/native-hook-relay*.ts` (18개 파일) - 외부 CLI 하네스의 훅을 게이트웨이로 되돌리는 브리지                                                                                                    |

FORK.md 10-3 의 실측 로그에서 `"runner": "embedded"` 가 찍힌 것이 (1) 경로다.

### 2-8. 모델 프로바이더 추상화

- **인터페이스 정본**: `src/plugins/provider-plugin.types.ts:93` `ProviderPlugin`. 필수 필드는 `id`, `label`, `auth: ProviderAuthMethod[]`. 그 밖에 `aliases`(`:99`), `envVars`(`:113`), `staticCatalog`(`:133`), `resolveDynamicModel`(`:159`), `prepareDynamicModel`(`:170`) 등.
- 인증 형태: `src/plugins/provider-authentication.types.ts:198,241,248`. 카탈로그 형태: `src/plugins/provider-catalog.types.ts:51`. 런타임 모델: `src/plugins/provider-runtime-model.types.ts:10`.
- 와이어 계약은 별도 패키지: `packages/llm-core/src/types.ts` - `Api`(`:6`), `Provider`(`:27`), `ThinkingLevel`(`:36`), `Transport`(`:55`), `ProviderResponse`(`:61`), `StreamOptions`(`:67`).
- 카탈로그: `packages/model-catalog-core/` + 파사드 `src/model-catalog/index.ts:1-10`.
- **"내장 프로바이더 배열" 같은 상수는 없다.** 프로바이더는 `extensions/*` 매니페스트의 `openclaw.providers` 를 스캔해 발견한다(`src/plugins/manifest.ts:216`, `src/plugins/bundled-plugin-scan.ts`). 가장 가까운 열거는 표시명 폴백 맵 `src/agents/sessions/provider-display-names.ts:5-36` (34개 id) 인데, 그 파일 주석이 스스로 "플러그인 메타데이터가 표시명을 안 줄 때의 폴백"이라고 못박는다. **실제 목록은 `extensions/` 의 프로바이더 플러그인 62개다.**
- 주의: `src/provider-runtime/` 에는 `operation-retry.ts` 하나뿐이다. 이름과 달리 프로바이더 인터페이스의 집이 아니다.

### 2-9. 채널 플러그인 인터페이스

- **인터페이스 정본**: `src/channels/plugins/types.plugin.ts:60` `ChannelPlugin<ResolvedAccount, Probe, Audit>`.
- 필수: `id: ChannelId`(`:61`), `meta: ChannelMeta`(`:62`), `capabilities: ChannelCapabilities`(`:63`), `config: ChannelConfigAdapter`(`:81`).
- 선택 어댑터 슬롯(전부 옵셔널): `setupWizard`(`:80`), `configSchema`(`:82`), `setupContract`(`:84`), `pairing`(`:87`), `security`(`:88`), `groups`(`:89`), `mentions`(`:90`), `outbound`(`:91`), `status`(`:92`), `gatewayMethods`/`gatewayMethodDescriptors`/`gateway`(`:93-95`), `auth`(`:97`), `commands`(`:100`), `lifecycle`(`:101`), `secrets`(`:102`), `allowlist`(`:103`), `doctor`(`:104`), `bindings`(`:105`), `streaming`(`:107`), `threading`(`:108`), `message`(`:109`), `messaging`(`:110`), `agentPrompt`(`:111`), `directory`(`:112`), `resolver`(`:113`), `actions`(`:114`), `heartbeat`(`:115`), `agentTools`(`:117`).
- 작성 진입점: `src/plugin-sdk/core.ts:553` `defineChannelPluginEntry(...)`, 내부에서 `:580` `api.registerChannel({ plugin })`. `registrationMode` 로 `cli-metadata` / `tool-discovery` / `discovery` / `full` 을 나눠 로드한다(`:562-596`).
- 호스트 등록: `src/plugins/registry-registrars-network.ts:273`, `src/plugins/loader-channel-runtime.ts:223`.

### 2-10. 스킬 로더와 ClawHub

- **스킬 = `SKILL.md` 를 담은 디렉터리.** 로더 `src/skills/loading/local-loader.ts:77` 이 `path.join(skillDir, "SKILL.md")` 를 읽고 `:89` 에서 frontmatter 를 파싱한다. `name`·`description` 이 없으면 거부(`:98-107`), `name` 기본값은 디렉터리명(`:96`), 표시명은 첫 H1(`src/skills/loading/skill-contract.ts:46-50`).
- frontmatter 의 `openclaw:` 블록 스키마: `src/skills/types.ts:5-34` (`always`, `skillKey`, `primaryEnv`, `emoji`, `homepage`, `os`, `requires.{bins,anyBins,env,config}`, `install[]` with `kind: brew|node|go|uv|download`). 호출 정책 `{ userInvocable, disableModelInvocation }` 은 `:36-39`.
- **탐색 한도**(`src/skills/loading/skill-root-discovery.ts:15-23`): 루트당 후보 300, 소스당 로드 200, 파일 256KB, 그룹 스캔 깊이 6. 심링크·경로 봉쇄 가드 포함.
- **소스 우선순위**(`src/skills/loading/workspace-skill-loader.ts:387-430`): `openclaw-bundled`(`skills/`) -> `openclaw-custodian`(`custodian-skills/`) -> `openclaw-extra`(설정 `extraDirs` + 플러그인 스킬) -> `openclaw-managed` -> `agents-skills-personal`(`~/.agents/skills`) -> `agents-skills-project`(`<workspace>/.agents/skills`) -> `openclaw-workspace`.
- 플러그인이 제공하는 스킬은 `~/.openclaw/plugin-skills/` 로 심링크된다(`src/skills/loading/plugin-skills.ts:209,275-287`). 로컬 인스턴스에도 실제로 그 디렉터리가 있다(실측 12K).
- **ClawHub = 원격 스킬/플러그인 레지스트리.** 기본 URL `https://clawhub.ai` (`src/infra/clawhub-client.ts:15`), 환경변수 `OPENCLAW_CLAWHUB_URL`/`CLAWHUB_URL` 로 교체(`:70-74`). 설치 라이프사이클 `src/skills/lifecycle/clawhub*.ts`, 신뢰 게이트 `src/infra/clawhub-install-trust.ts`, 검증 스키마 `src/infra/clawhub-skills.ts:141,192`, 설치 종류 `clawhub | github | skills-sh`(`:53`).

### 2-11. 메모리 색인

메모리는 **코어에 얇게, 플러그인과 SDK 에 두껍게** 있다(`src/memory/` 는 3파일뿐).

| 계층        | 위치                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 호스트 SDK  | `packages/memory-host-sdk/src/host/` - 스키마(`memory-schema-base.ts:16-34`), FTS5 생성(`memory-schema-fts.ts:168,240`), sqlite-vec 로딩(`sqlite-vec.ts:58-90`), 임베딩 클라이언트(`embeddings-remote-provider.ts`, `batch-runner.ts`) |
| 기본 구현   | `extensions/memory-core/` - 동기화(`src/memory/manager-sync-base.ts:591` 에서 `vec0` 가상 테이블 생성), KNN 검색(`manager-search-knn.ts` + 취소용 서브프로세스 `manager-search-knn-subprocess.ts`), 리셋(`manager-db.ts:123,238,324`)  |
| 선택 백엔드 | `extensions/memory-lancedb/` - LanceDB. 런타임 동적 import(`lancedb-runtime.ts:2,47`), 기본 경로 `~/.openclaw/memory/lancedb`(`config.ts:30`). 기본 설치가 아니다                                                                      |
| 위키형      | `extensions/memory-wiki/`                                                                                                                                                                                                              |
| 설정        | `src/config/types.memory.ts` - 벡터 스토어 토글 `:80-83`, 캐시 `:85-101`, FTS 토크나이저 `unicode61 \| trigram` `:76-79`                                                                                                               |

---

## 3. 프런트

### 3-1. Control UI (`ui/`)

| 항목                | 값                                                                                                                        | 근거                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 프레임워크          | **Lit 3.3.3** (Web Components). React·Preact 아님                                                                         | `ui/package.json:44`                                                                                       |
| 상태/DI             | `@lit/context 1.1.6` + 손으로 만든 스토어. Redux·MobX·시그널 라이브러리 없음                                              | `ui/package.json:19`; `ui/src/app/gateway-store.ts`, `server-prefs-state.ts`, `sidebar-attention-store.ts` |
| 라우터              | `@openclaw/uirouter 0.1.1` (외부 패키지)                                                                                  | `ui/package.json:35`; `ui/src/app/router-outlet.ts`, `ui/src/app-routes.ts`                                |
| 컴포넌트 라이브러리 | `@awesome.me/webawesome 3.12.0`                                                                                           | `ui/package.json:12`                                                                                       |
| 번들러              | **Vite 8.2.2** (Rolldown)                                                                                                 | `ui/package.json:60`; `ui/vite.config.ts:599-607` `rolldownOptions`                                        |
| 진입                | `ui/index.html:565` -> `/src/main.ts`, 루트 엘리먼트 `<openclaw-app>`(`index.html:357`)                                   |                                                                                                            |
| 베이스 클래스       | `ui/src/lit/openclaw-element.ts:5` `OpenClawLitElement`, `:10-11` light-DOM 변형                                          |                                                                                                            |
| CSS                 | 순수 CSS + CSS 변수 토큰. Tailwind 없음. PostCSS 는 커스텀 플러그인 하나(`control-ui-hover-guard`)만                      | `ui/src/styles.css:1-8`; `ui/vite.config.ts:574-578`                                                       |
| i18n                | 라이브러리 없이 자체 구현. **21개 로케일**(en + 지연 로드 20)                                                             | `ui/src/i18n/lib/registry.ts:7,9-30,35`                                                                    |
| 카탈로그            | TypeScript 모듈 (`ui/src/i18n/locales/en.ts` 외 네임스페이스 분할 15개)                                                   |                                                                                                            |
| 테마                | 토큰은 `ui/src/styles/base.css`, 추가 팔레트 10종은 `ui/public/themes/*.css`, 이름 레지스트리 `ui/src/app/theme.ts:41-54` |                                                                                                            |

`ui/src` 구조(depth 2): `api/` `app/` `components/` `e2e/` `features/` `i18n/{lib,locales,test}` `lib/{agents,board,channels,chat,config,cron,nodes,...}` `lit/` `pages/{about,activity,agents,approval,apps,channels,chat,config,cron,dashboards,debug,device,devices,logs,meetings,memory-import,model-providers,...}` `plugins/` `styles/` `types/`.

**WS 클라이언트**: `ui/src/api/gateway.ts:1-29` 가 `@openclaw/gateway-client/browser` 에서 `GatewayProtocolClient`·`PROTOCOL_VERSION`·`buildGatewayConnectAuth` 등을 가져온다. 실제 소켓은 `ui/src/api/gateway-browser-socket.ts:7-12` `createBrowserGatewaySocket()` 이 `new WebSocket(url)` 로 만든다.

### 3-2. 빌드 산출물과 게이트웨이 서빙

```
pnpm ui:build
  -> scripts/ui.js:2-5 -> scripts/ui.mts:393-394 (vite build)
  -> ui/vite.config.ts:26  outDir = <repo>/dist/control-ui        (ui/dist 가 아니다)
  -> ui/vite.config.ts:595-598  { emptyOutDir: true, sourcemap: true }
  -> 부가 산출: .br/.gz 사전압축(:468-505), 해시 에셋 매니페스트(:540-559), 서비스워커 sw.js(:431-441)

게이트웨이 서빙
  -> src/infra/control-ui-assets.ts:183 resolveControlUiRootSync()
       후보 경로 :213-221  <execDir>/../Resources/control-ui, <moduleDir>/control-ui,
                            <moduleDir>/../control-ui, <moduleDir>/../../dist/control-ui,
                            <argv1Dir>/dist/control-ui
  -> src/gateway/server-control-ui-root.ts   (라이프사이클)
  -> src/gateway/control-ui.ts:1004 handleControlUiHttpRequest()
       SPA fallback :1186-1190, 경로 봉쇄 :1203-1207, 사전압축 협상 :1209-1215
  -> src/gateway/control-ui-static.ts:10  Cache-Control: public, max-age=31536000, immutable
  -> 설정 override: gateway.controlUi.root  (src/config/types.gateway.ts:143-144)
```

빌드가 없으면 `src/gateway/control-ui.ts:239` 가 "Control UI assets not found at ... Build them with `pnpm ui:build`" 를 그대로 뱉는다.

### 3-3. 네이티브 앱 (`apps/`)

| 디렉터리              | 무엇                                                        | 스택                                                                          | 근거                                                                                      |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/android/`       | Android 폰 앱 + Wear OS 모듈                                | Kotlin + Jetpack Compose, Gradle KTS                                          | `apps/android/app/build.gradle.kts:106,116,200,320-335` (`namespace = "ai.openclaw.app"`) |
| `apps/ios/`           | iOS 앱 + WatchApp + ShareExtension + ActivityWidget         | Swift 6 / SwiftUI, XcodeGen                                                   | `apps/ios/project.yml:1,4-6,10,14-20`                                                     |
| `apps/macos/`         | macOS 메뉴바 앱 + `openclaw-mac` CLI + IPC 라이브러리       | Swift 6.3 SwiftPM, SwiftUI, Sparkle 업데이터                                  | `apps/macos/Package.swift:1,7-16,17-28`                                                   |
| `apps/macos-mlx-tts/` | 온디바이스 MLX TTS 헬퍼 실행파일(격리)                      | Swift 6.3 + mlx-audio-swift                                                   | `apps/macos-mlx-tts/Package.swift:1-2,13,16-19`                                           |
| `apps/linux/`         | 리눅스 데스크톱 컴패니언                                    | Rust + Tauri 2, 프레임워크 없는 HTML/CSS/JS 웹뷰                              | `apps/linux/src-tauri/Cargo.toml:1-13`; `apps/linux/ui/index.html`                        |
| `apps/shared/`        | iOS·macOS·watch 공용 Swift 패키지                           | Swift 6.3 SwiftPM (`OpenClawKit`, `OpenClawProtocol`, `OpenClawChatUI`, GRDB) | `apps/shared/OpenClawKit/Package.swift:1,12-16,22-25`                                     |
| `apps/swabble/`       | 독립 Swift 라이브러리 + `swabble` CLI (iOS/macOS 에 벤더링) | Swift 6.3 SwiftPM                                                             | `apps/swabble/Package.swift:1,5-9,10-14`                                                  |
| `apps/mobile/`        | **버전 핀 스텁뿐.** 소스도 빌드 파일도 없다                 | -                                                                             | `apps/mobile/version.json` 한 파일 (`{"version":"2026.8.1"}`)                             |

### 3-4. 그 밖의 프런트 표면

| 표면                     | 위치                                                                                                              | 스택                                                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TUI                      | `src/tui/` (122 파일)                                                                                             | `@earendil-works/pi-tui`. Ink·React 아님. `src/tui/tui.ts:5-12`, 게이트웨이 연결 `gateway-chat.ts`                                                                                                                                        |
| Telegram Mini App        | `extensions/telegram/src/miniapp/`                                                                                | **프레임워크 없음.** 서버가 인라인 CSS + nonce 인라인 스크립트로 HTML 한 장을 렌더한다(`page.ts:8-11,14-32`). `/__openclaw_tg_miniapp/` 에 서빙되고, launch ticket 을 기기 부트스트랩 토큰으로 바꿔 Control UI 로 넘긴다(`routes.ts:5-8`) |
| 웹 채팅                  | 별도 앱이 아니라 Control UI 안의 페이지                                                                           | 서버 `src/gateway/server-methods/chat-webchat-media.ts`, UI `ui/src/pages/chat/`                                                                                                                                                          |
| Canvas                   | `extensions/canvas/` (백엔드 A2UI JSONL 위젯) + 렌더러는 Control UI Lit 컴포넌트                                  | `ui/src/components/canvas-widget-view.ts`                                                                                                                                                                                                 |
| Control UI 플러그인 표면 | `ui/src/plugins/` (`control-ui-host.ts`, `control-ui-loader.ts`) + 서버 `src/gateway/control-ui-plugin-assets.ts` | 플러그인이 UI 탭을 추가하는 경로                                                                                                                                                                                                          |

---

## 4. 데이터 저장

### 4-1. 드라이버: `node:sqlite` 하나

- 로더 정본: `src/infra/node-sqlite.ts:1-11` - `createRequire` 로 `require("node:sqlite")`. **better-sqlite3·libsql·@libsql·bun:sqlite 는 저장소 어디에도 없다**(node_modules 제외 전량 grep 결과 0).
- 안전 게이트: 같은 파일 `:47-64` 가 SQLite 3.51.3 / 3.50.7 / 3.44.6 미만을 **거부**한다(업스트림 WAL 리셋 손상 버그). Windows 롱패스 네임스페이싱(`:17-24`)과 immutable URI 생성(`:34-45`)도 여기 있다.
- Bun 은 `bun:sqlite` 가 아니라 Bun 의 `node:sqlite` 호환 계층으로만 지원된다(`src/daemon/program-args.ts:198` 의 에러 문구, `openclaw.mjs` 의 feature probe).
- **Kysely 는 드라이버가 아니라 컴파일 전용 쿼리 빌더**다: `src/infra/kysely-sync.ts:47-54` `compileOnlySqliteDialect` 는 실행을 시도하면 throw 하고, 컴파일된 SQL 만 `DatabaseSync` 에 동기 실행한다. CI 가 `pnpm lint:kysely` / `db:kysely:check` 로 강제한다.
- `sqlite-vec 0.1.9` 는 `optionalDependencies` (루트 `package.json`). 로드 지점은 `packages/memory-host-sdk/src/host/sqlite-vec.ts:58-90` (`enableLoadExtension` -> `loadExtension` -> `SELECT vec_version()` 헬스체크), 플랫폼별 폴백 `sqlite-vec-platform-variant.ts:10-14`.

### 4-2. 스키마 정본과 마이그레이션

**마이그레이션 디렉터리도, 번호 매긴 마이그레이션 파일도, ORM 마이그레이터도 없다.** 대신 **체크인된 전체 스키마 `.sql` + `PRAGMA user_version` 사다리**다.

| 항목               | 값                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 공용 DB 스키마     | `src/state/openclaw-state-schema.sql` - **2,493줄 / `CREATE TABLE` 122개**, 전부 `STRICT`                                                                                                                                                                                 |
| 에이전트 DB 스키마 | `src/state/openclaw-agent-schema.sql` - **780줄 / `CREATE TABLE` 39개**                                                                                                                                                                                                   |
| 스키마 버전 상수   | `src/state/openclaw-state-db-contract.ts:15` `= 15`, `src/state/openclaw-agent-db-contract.ts:24` `= 19`                                                                                                                                                                  |
| package.json 선언  | `package.json:4-9` `openclaw.schemaVersions = { state: 15, agent: 19 }` - 런타임 마이그레이션용이 아니라 **업데이트 프리플라이트용**(`src/state/openclaw-schema-versions.ts:22-33`, `src/infra/update-runner-git-target.ts:36`)                                           |
| 실측 대조          | WSL 로컬 인스턴스 `~/openclaw-local/.openclaw/state/openclaw.sqlite` 의 `PRAGMA user_version` = **15**, 테이블·뷰 108개 (`node:sqlite` 로 직접 조회)                                                                                                                      |
| 업그레이드 본체    | `src/state/openclaw-state-db.ts:390-455` - `BEGIN IMMEDIATE` 안에서 은퇴 테이블 정리 -> 개별 마이그레이션 함수들 -> `executeCanonicalStateSchema`(:424) -> STRICT 전환(:427-437) -> 인덱스 복구(:438) -> `PRAGMA user_version = 15`(:442) -> `schema_meta` 갱신(:443-455) |
| 에이전트 DB 사다리 | `src/state/openclaw-agent-db-schema.ts:162-…`(`userVersion < 7`, `< 6`, `< 3` 분기), 종결 `:688`                                                                                                                                                                          |
| 은퇴 테이블        | 데이터 주도: `src/state/openclaw-schema-retirements.json` -> `src/state/openclaw-state-db-table-retirements.ts:18-25`                                                                                                                                                     |
| 버전 역행 거부     | `src/infra/sqlite-user-version.ts:38-50`, 문서 `docs/reference/database-schemas.md:104-118` (exit 78)                                                                                                                                                                     |
| Kysely 타입        | **.sql 에서 생성**한다: `scripts/generate-kysely-types.mts:11,16` -> `src/state/openclaw-state-db.generated.d.ts`, `openclaw-agent-db.generated.d.ts`                                                                                                                     |

**스키마를 고치려면**: `.sql` 을 고치고 -> 버전 상수를 올리고 -> 마이그레이션 함수를 사다리에 추가하고 -> `pnpm db:kysely:gen` 으로 타입을 재생성하고 -> `pnpm sqlite:sessions-schema:gen` 베이스라인을 갱신한다. CI 에 `check-sqlite-session-schema-baseline` 잡이 있다(`.github/workflows/ci.yml:1660`).

### 4-3. 디스크 위의 DB 파일

| 파일                                 | 경로 결정                                                                                                 | 담는 것                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **`openclaw.sqlite`**                | `src/state/openclaw-state-db.paths.ts:6-13` -> `<stateDir>/state/openclaw.sqlite`                         | 공용 제어 평면 (아래 표)                             |
| **`openclaw-agent.sqlite`**          | `src/state/openclaw-agent-db.paths.ts:22-34` -> `<stateDir>/agents/<agentId>/agent/openclaw-agent.sqlite` | 세션·전사·FTS·메모리 색인·인증 프로필·보드           |
| `incognito-openclaw-agent.sqlite`    | 같은 파일 `:19,37-44`                                                                                     | 시크릿 모드                                          |
| `openclaw-quarantine.sqlite`         | `src/state/openclaw-quarantine-store.ts:30-32`                                                            | 손상 격리 DB 목록                                    |
| `plugins/workboard/workboard.sqlite` | `extensions/workboard/src/sqlite-store.ts:42,57-59`                                                       | 워크보드 (자체 `SCHEMA_VERSION = 3`)                 |
| `logbook.sqlite` + `frames/`         | `extensions/logbook/src/store.ts:186-190`                                                                 | 로그북                                               |
| `managed-update-handoffs.sqlite`     | `src/infra/update-managed-service-handoff.ts:1525`                                                        | 업데이트 핸드오프                                    |
| `debug-proxy/capture.sqlite`         | `src/proxy-capture/paths.ts:12-19`                                                                        | **deprecated.** 캡처는 공용 DB `capture_*` 로 이관됨 |

### 4-4. 테이블 그룹

**공용 `openclaw.sqlite`** (줄 번호는 `src/state/openclaw-state-schema.sql`):

| 그룹                    | 테이블                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 메타                    | `schema_meta`:573, `config_machine_state`:583, `config_revision_keys`:258, `config_health_entries`:1038                                                                                                                                          |
| 감사·실행 신원          | `audit_events`:151, `audit_identity_keys`:251, `execution_identity_contexts`:263, `execution_decision_facts`:278                                                                                                                                 |
| 세션 제어평면           | `session_state_events`:314, `session_state_heads`:335, `session_watch_cursors`:349, `session_upstream_links`:363, `session_groups`:1866, `state_leases`:383                                                                                      |
| 승인                    | `exec_approvals_config`:402, `operator_approvals`:416, `plugin_binding_approvals`:1659                                                                                                                                                           |
| **기기·페어링**         | `device_pairing_pending`:589, `device_pairing_paired`:612, `device_bootstrap_tokens`:640, `device_pairing_join_codes`:673, `device_identities`:680, `device_auth_tokens`:692, `gateway_origin_device_tokens`:704, `channel_pairing_requests`:813 |
| 푸시                    | `web_push_subscriptions`:842, `apns_registrations`:872                                                                                                                                                                                           |
| 크론·작업               | `cron_jobs`:1447, `cron_run_receipts`:1471, `task_runs`:1572, `subagent_runs`:1618, `flow_runs`:1679, `delivery_queue_entries`:1537                                                                                                              |
| 에이전트 레지스트리     | `agent_databases`:1226, `agent_provenance`:1248, `agent_database_leases`:1255                                                                                                                                                                    |
| 플러그인·스킬           | `plugin_state_entries`:1264, `plugin_blob_entries`:1314, `skill_usage`:28, `skill_workshop_*`:83-129, `skill_uploads`:1332                                                                                                                       |
| 워커·워크트리           | `worker_environments`:1876, `worker_session_placements`:1942, `worker_transcript_commits`:2322, `worker_inference_turns`:2343, `worktrees`:1814, `projects`:1845, `fleet_cells`:2366                                                             |
| 회의 전사               | `meeting_transcript_sessions`:1707, `..._utterances`:1738, `..._summaries`:1756                                                                                                                                                                  |
| 게이트웨이 라이프사이클 | `gateway_restart_sentinel`:1102, `gateway_boot_lifecycle`:1156, `update_runs`:1075, `migration_runs`:1770, `backup_runs`:1803                                                                                                                    |
| ACP                     | `acp_sessions`:1169, `acp_replay_sessions`:1191, `acp_replay_events`:1211                                                                                                                                                                        |
| 시크릿·미디어           | `secret_store_entries`:2478, `outbound_media_provenance`:2467, `mcp_oauth_stores`:3                                                                                                                                                              |

공용 DB 에는 **FTS5 테이블이 없다.**

**이 포크가 추가한 feature-local 표**(`.sql` 이 아니라 각 기능 모듈이 처음 쓸 때 만든다. `user_version` 은 15 그대로다):

| 표                                                         | 정본 모듈                                 | 담는 것                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `departments` · `department_members` · `department_agents` | `src/state/departments-schema.ts`         | 부서 목록 · 소속 투영 · 에이전트 바인딩                                                                       |
| `audit_user_activity`                                      | `src/state/user-activity-audit-schema.ts` | 사람 귀속 감사 원장(보존 90일)                                                                                |
| `inbound_media`                                            | `src/state/inbound-media-schema.ts`       | 채팅 첨부 소유자(세션 · 에이전트 · 프로필 · 원본명 · 크기 · 삭제 표시). 부서 열은 없고 `agent_id` 로 파생한다 |

**에이전트별 `openclaw-agent.sqlite`** (줄 번호는 `src/state/openclaw-agent-schema.sql`):

| 그룹                   | 테이블                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 세션                   | `session_nodes`:15, `session_participants`:79, `session_windows`:116, `session_conversations`:225, `conversations`:160, `conversation_deliveries`:193                                                                                                                                                                                                                                                                                       |
| **전사**               | `transcript_events`:393, `session_transcript_archives`:404, `transcript_event_identities`:463, `trajectory_runtime_events`:436                                                                                                                                                                                                                                                                                                              |
| **FTS5**               | `standing_intents_fts`:**636**, `session_transcript_fts`:**698** (+ 상태 테이블 `session_transcript_index_state`:666)                                                                                                                                                                                                                                                                                                                       |
| **메모리 색인·임베딩** | `memory_index_meta`:533, `memory_index_sources`:538, `memory_index_chunks`:548, `memory_index_chunk_provenance`:569, `memory_embedding_cache`:595, `memory_index_state`:606. **.sql 에 없고 런타임에 생기는 것**: `memory_index_chunks_fts`·`memory_index_paths_fts`(fts5, `packages/memory-host-sdk/src/host/memory-schema-fts.ts:168,240`), `memory_index_chunks_vec`(vec0, `extensions/memory-core/src/memory/manager-sync-base.ts:591`) |
| **인증 프로필**        | `auth_profile_store`:521, `auth_profile_state`:527                                                                                                                                                                                                                                                                                                                                                                                          |
| **대시보드·보드**      | `board_tabs`:292, `board_widgets`:304, `session_progress_cards`:336 (지연 생성 `src/state/openclaw-agent-board-schema.ts:26-30`)                                                                                                                                                                                                                                                                                                            |
| 캐시                   | `cache_entries`:504                                                                                                                                                                                                                                                                                                                                                                                                                         |

인증 프로필 DB 는 별도 파일이 아니다: `src/agents/auth-profiles/sqlite.ts:199-203` 이 `<agentDir>/openclaw-agent.sqlite` 를 그대로 돌려주고, 설정 `auth.sharedStore.location === "state-db"` 면 공용 DB 로 간다(`src/agents/auth-profiles/path-resolve.ts:103-108`).

### 4-5. 파일 기반 저장

| 대상                                 | 경로                                                                                                               | 근거                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 상태 디렉터리                        | `$OPENCLAW_STATE_DIR` 없으면 `~/.openclaw` (레거시 `~/.clawdbot` 폴백)                                             | `src/config/paths.ts:26-27,71-100`                                                                                                                                          |
| 설정 파일                            | `<stateDir>/openclaw.json` (`OPENCLAW_CONFIG_PATH` 로 override)                                                    | `src/config/paths.ts:28-29,275-284,380-404`                                                                                                                                 |
| **설정 형식**                        | **JSON5** - 주석 허용, `$include` 지시자, 환경변수 치환                                                            | 파싱 `src/config/io.load.ts:57`; include `src/config/includes.ts:5-8`; env 치환 `src/config/env-substitution.ts:219`; 주석 소실 경고 `src/config/io.observe-recovery.ts:33` |
| `$include` 허용 루트                 | `OPENCLAW_INCLUDE_ROOTS`                                                                                           | `src/config/paths.ts:240-266`                                                                                                                                               |
| 워크스페이스 (Markdown, `AGENTS.md`) | `$OPENCLAW_WORKSPACE_DIR` 없으면 `<stateDir>/workspace`                                                            | `src/agents/workspace-default.ts:14-34`                                                                                                                                     |
| 세션 파일                            | `<stateDir>/agents/<agentId>/sessions/`                                                                            | `src/config/sessions/paths.ts:12-35`                                                                                                                                        |
| 미디어 blob                          | `<configDir>/media` (+ `outgoing/`, `outbound/`, `playback-transcode/`)                                            | `src/media/store.ts:29,37-46`                                                                                                                                               |
| **채팅 첨부(인바운드)**              | `<configDir>/media/inbound/<정제원본명>---<uuid><확장자>` - 소유자는 공용 DB `inbound_media` 가 따로 들고 있다     | `src/media/store.ts:361-375,564-594`, `src/gateway/inbound-media-access.ts`                                                                                                 |
| 미배달 첨부                          | `<stateDir>/delivery-queue-media`                                                                                  | `src/config/paths.ts:427-429`                                                                                                                                               |
| 로그                                 | `<stateDir>/logs/` - `anthropic-payload.jsonl`, `cache-trace.jsonl`, `raw-stream.jsonl`, 설정 감사 로그, 지원 번들 | `src/agents/anthropic-payload-log.ts:51` 외                                                                                                                                 |
| 게이트웨이 락                        | `<stateDir>/tmp/openclaw-<uid>`                                                                                    | `src/config/paths.ts:412-420`                                                                                                                                               |
| 플러그인                             | `<stateDir>/plugins/`                                                                                              | `src/cli/program/config-guard.ts:142`                                                                                                                                       |

### 4-6. 외부 DB 옵션

**없다.** Postgres·MySQL·MariaDB·Redis·MongoDB·ClickHouse 드라이버가 `src/`·`packages/`·`extensions/`·`ui/` 어디에도 없다. 전량 grep 에서 나온 히트는 두 개뿐이고 둘 다 드라이버가 아니다.

- `src/logging/redact-patterns.ts:147` - 로그에 섞여 들어온 `postgres://`·`mysql://`·`mongodb://`·`redis://` 연결 문자열을 **가리는 정규식**.
- `extensions/memory-wiki/src/chatgpt-import.ts:389` - 분류기의 키워드 목록.

`package.json` 의존성 스캔에서도 `pg`·`mysql`·`redis`·`drizzle`·`prisma` 는 0건이다. 저장소 관련 의존성은 `kysely`(컴파일 전용)와 `sqlite-vec`(옵셔널)뿐이다. 문서도 다른 백엔드를 "아직 없는 것"으로 다룬다(`docs/reference/database-schemas.md:5`).

**비 SQLite 영속 저장소는 파일시스템과 선택적 LanceDB 두 가지뿐이다.**

---

## 5. 인프라 요구

### 5-1. 런타임

| 항목               | 값                                                                                                        | 근거                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Node               | `>=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0`                                                          | `package.json` `engines.node`                    |
| 권장 메이저        | 26                                                                                                        | `openclaw.mjs` `RECOMMENDED_NODE_MAJOR = 26`     |
| pnpm               | **12.1.0** (corepack 핀)                                                                                  | `package.json` `packageManager`                  |
| Bun                | `node:sqlite` 를 제공하는 빌드만. 없으면 즉시 exit 1                                                      | `openclaw.mjs` `ensureSupportedRuntimeVersion()` |
| 네이티브 빌드 도구 | **불필요** (prebuilt 를 받는다). 이 PC 실측으로 Ubuntu 24.04 기본 + Node 24 만으로 `pnpm install` 통과    | FORK.md 6-1                                      |
| pnpm 링커          | `nodeLinker: isolated`, `verifyDepsBeforeRun: false`, `blockExoticSubdeps: true`                          | `pnpm-workspace.yaml:44-49`                      |
| 의존성 쿨다운      | `minimumReleaseAge: 10080`(7일), strict. 예외는 `minimumReleaseAgeExclude` 에 사유와 만료일까지 적혀 있다 | `pnpm-workspace.yaml:8-40`                       |

### 5-2. OS 지원

`package.json` 에 `os` 필드는 없다. 실질 지원 범위는 CI 매트릭스와 코드로 확인된다.

- Linux(주 레인): CI 기본 러너 `ubuntu-24.04` / blacksmith (`.github/workflows/ci.yml:98`).
- Windows: `checks-windows-node-test-<part>` 잡(`ci.yml:1744`), `src/cli/windows-argv.ts`, `openclaw.mjs` 의 `SIGBREAK` 분기, `node-sqlite.ts:17-24` 롱패스 처리, `test:windows:schtasks:integration` 스크립트.
- macOS: `macos-node-<part>` 잡(`ci.yml:1755`), launchd 코드(`src/cli/daemon-cli/launchd-recovery.ts`).
- Android/iOS: 별도 릴리스 워크플로(`android-release.yml`, `ios-beta-release.yml` 등).

### 5-3. 필수 외부 서비스

**없다.** 게이트웨이는 SQLite + 파일시스템만으로 뜬다. 다음은 전부 선택이다.

| 것                         | 필수 여부                                                                          | 근거                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Tailscale                  | 선택                                                                               | `src/gateway/server-tailscale.ts`, `tailscale-published-origin.ts`                                                                     |
| Cloudflare                 | 선택                                                                               | `src/cli/connect-cli.ts`, `src/cli/node-cli/gateway-options.ts` (Cloudflare Access 옵션), `src/node-host/gateway-cloudflare-access.ts` |
| Bonjour/mDNS               | 선택. 컨테이너에서는 자동 비활성                                                   | `docker-compose.yml` `OPENCLAW_DISABLE_BONJOUR` 주석; `extensions/bonjour/`                                                            |
| OpenTelemetry / Prometheus | 선택 (아웃바운드 OTLP). Prometheus 는 별도 포트 없이 인증된 게이트웨이 경로를 쓴다 | `docker-compose.yml` OTEL 블록 주석; `extensions/diagnostics-otel/`, `extensions/diagnostics-prometheus/`                              |
| ClawHub                    | 선택 (스킬 설치 시에만)                                                            | `src/infra/clawhub-client.ts:15`                                                                                                       |
| 모델 API                   | 최소 하나 필요(제품 기능상). 인프라 의존은 아님                                    | -                                                                                                                                      |

### 5-4. 포트

| 포트      | 무엇                                                          | 근거                                            |
| --------- | ------------------------------------------------------------- | ----------------------------------------------- |
| **18789** | 게이트웨이 HTTP + WS (Control UI 포함). 기본 bind 는 loopback | `src/config/paths.ts:406`; `docker-compose.yml` |
| 18790     | 브라우저 브리지                                               | `docker-compose.yml` `OPENCLAW_BRIDGE_PORT`     |
| 3978      | MS Teams 웹훅                                                 | `docker-compose.yml` `OPENCLAW_MSTEAMS_PORT`    |

### 5-5. 프로세스 모델

**단일 프로세스가 기본**이고, 그 위에 감독·워커·사이드카가 얹힌다.

```
openclaw.mjs (런처 = respawn 감독자)
   └─ dist/entry.js  = 게이트웨이 프로세스 1개
        ├─ node:http/https 리스너 + ws WebSocketServer(noServer)
        ├─ 플러그인 in-process 로드 (채널·프로바이더·도구)
        ├─ worker_threads: prepared-model-catalog / session-accessor.sqlite-archive /
        │                  session-transcript-reconcile / sqlite-integrity  (src/*.worker.ts)
        ├─ child_process: ACP 하네스(codex·claude 등), 브라우저 사이드카, KNN 취소용 서브프로세스
        └─ 원격 노드(src/node-host/): 다른 기기가 게이트웨이에 붙어 워커 역할
```

- respawn 감독은 런처(`openclaw.mjs` `runRespawnedChild`)와 그 TS 판(`src/entry.respawn.ts`)에 있다.
- worker_threads 사용처: `src/agents/prepared-model-catalog.worker.ts`, `src/config/sessions/session-accessor.sqlite-archive.worker.ts`, `src/config/sessions/session-transcript-reconcile.worker.ts`, `src/infra/sqlite-integrity.worker.ts`, `src/gateway/system-ca-warmup.ts`.
- 워커 배치·이동은 게이트웨이가 관리한다: `src/gateway/server-worker-placement-*.ts` 12개 파일 + DB 테이블 `worker_session_placements`.

### 5-6. 서비스 설치 (systemd / launchd / schtasks)

| 코드                                                                                | 하는 일                                       |
| ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `src/cli/daemon-cli/install.ts`                                                     | `openclaw gateway install` - 서비스 유닛 생성 |
| `src/cli/daemon-cli/lifecycle.ts`, `lifecycle-core.ts`, `lifecycle-safe-restart.ts` | start/stop/restart                            |
| `src/cli/daemon-cli/launchd-recovery.ts`                                            | macOS launchd 복구                            |
| `src/cli/daemon-cli/status.gather.ts`, `status.print.ts`                            | 상태 조회                                     |
| `src/cli/gateway-cli/run-loop.ts`, `run.ts`                                         | 포그라운드 실행                               |

**함정 (실측)**: `openclaw gateway install` 은 비기본 state dir 을 거부한다(`service management skipped: non-default state dir or config path`). 그래서 이 포크는 유닛을 직접 들고 있다: `chris-local/openclaw-local.service`, `chris-local/openclaw-auto-deploy.{service,timer}` (FORK.md 7-3).

### 5-7. Docker

```
Dockerfile (438줄, 멀티스테이지)
  workspace-deps      node:24-bookworm@sha256:934240a1...   package.json 만 추출
  dependency-inputs   같은 이미지                            corepack enable
  production-deps     <- dependency-inputs                  런타임 의존만 설치 + 네이티브 애드온 검증
  bun-binary          oven/bun:1.4.0@sha256:5ff60936...
  build               <- dependency-inputs                  전체 빌드
  runtime-build-output / runtime-assets                     dist 정리·플러그인 프루닝
  base-runtime        node:24-bookworm-slim@sha256:3638d9a6...
  최종                USER node, ENTRYPOINT ["tini","-s","--"], CMD ["node","openclaw.mjs","gateway"]
```

- 베이스 이미지는 전부 **SHA256 다이제스트 핀**(`Dockerfile:16-21`). Dependabot 이 갱신한다.
- 런타임 apt 패키지(`Dockerfile:251`): `ca-certificates curl git hostname libgomp1 lsof openssh-client openssl procps python3 tini`.
- Playwright chromium 을 조건부로 설치한다(`Dockerfile:342-350`, `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright`).
- 보안: 비루트 `USER node`, compose 에서 `cap_drop: [NET_RAW, NET_ADMIN]`, `no-new-privileges:true`.
- 컨테이너 안 경로를 고정한다(`docker-compose.yml`): `OPENCLAW_HOME=/home/node`, `OPENCLAW_STATE_DIR=/home/node/.openclaw` 등. 호스트 `.env` 의 경로가 새어 들어가 macOS 경로로 mkdir EACCES 가 났던 이슈(#77436)의 대책이라고 주석에 적혀 있다.

**이미지 크기 4.37GB 의 내역** (이 PC `docker history openclaw-chris:local` 실측):

| 레이어                      | 크기       | 무엇                           |
| --------------------------- | ---------- | ------------------------------ |
| `COPY /app/node_modules`    | **2.65GB** | 압도적 1위                     |
| `COPY /app/dist`            | 175MB      | 빌드 산출물                    |
| Node 배포 설치 RUN          | 155MB      | 베이스의 Node                  |
| 익명 RUN(2)                 | 151MB      | (Playwright/apt 계열)          |
| debian bookworm-slim 베이스 | 85.3MB     |                                |
| RUN(3)                      | 53.3MB     |                                |
| `COPY /app/extensions`      | 43.9MB     | 플러그인 153개                 |
| `COPY /app/docs`            | 25.7MB     | 문서 751개가 이미지에 들어간다 |
| `COPY /app/qa`              | 3.58MB     |                                |

즉 **크기의 주범은 `node_modules` 하나**다. 줄이려면 `OPENCLAW_EXTENSIONS` 빌드 인자로 플러그인을 골라 빌드하는 길이 있다(`Dockerfile:1-3, 11`).

### 5-8. 리소스 실측 (WSL2 Ubuntu, 2026-09-06)

| 항목                           | 값                                                          | 방법                                                                   |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| 게이트웨이 RSS                 | **418MB** (재시작 직후 유휴) ~ **600MB** (빌드와 겹친 시점) | `ps -eo pid,rss,cmd --sort=-rss`                                       |
| 인스턴스 상태 총량             | **108MB**                                                   | `du -sh ~/openclaw-local/.openclaw`                                    |
| 그중 `cache/control-ui-assets` | 104MB                                                       | 대부분이 이것이다                                                      |
| `state/openclaw.sqlite`        | 3.53MB (+ WAL 157KB, SHM 32KB)                              | `ls -la state/`                                                        |
| 워크스페이스                   | 152KB                                                       |                                                                        |
| 소스 체크아웃 `node_modules`   | 2.6GB                                                       | `du -sh`                                                               |
| 빌드 산출물 `dist/`            | 249MB                                                       |                                                                        |
| `.git`                         | 3.6GB                                                       |                                                                        |
| `.cache/vitest`                | **28GB**                                                    | 전체 테스트를 한 번 돌린 뒤의 vitest 캐시. 필요하면 지워도 되는 파생물 |
| 빌드 시간                      | `pnpm build` 3분 47초 (증분·캐시 적중 포함)                 | `chris-local/auto-deploy.log`                                          |

디스크 계획에서 **`.cache/vitest` 28GB 가 최대 변수**다. 전체 테스트를 돌리지 않는 배포 머신에서는 생기지 않는다.

---

## 6. 빌드·테스트 파이프라인

### 6-1. `pnpm build`

`package.json` `"build": "node --import ./scripts/tsx.mjs scripts/build-all.mts"`. 단계는 `scripts/build-all.mts:75-160` 에 배열로 선언돼 있고, 각 단계에 입력·출력 해시 캐시가 붙는다.

| 순서 | 단계                                                      | 하는 일                                                                                                                                                                                                |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `clean:dist`                                              | `dist/` 삭제                                                                                                                                                                                           |
| 2    | `plugins:assets:build`                                    | 플러그인 에셋 빌드                                                                                                                                                                                     |
| 3    | `tsdown`                                                  | **백엔드 번들** (tsdown = rolldown 기반). 설정 `tsdown.config.ts`                                                                                                                                      |
| 4    | `tsdown-ai`                                               | `tsdown.ai.config.ts` (@openclaw/ai)                                                                                                                                                                   |
| 5    | `tsdown-packages`                                         | `packages/*` 빌드                                                                                                                                                                                      |
| 6    | `tsdown-unified`                                          | 통합 엔트리                                                                                                                                                                                            |
| 7    | `write-unified-entry-dts`                                 | 타입 선언 생성 (**실측 최장 단계, 2분 44초**)                                                                                                                                                          |
| 8    | `external-plugins:local-dist`                             | 외부 플러그인 로컬 dist                                                                                                                                                                                |
| 9    | `check-cli-bootstrap-imports`                             | CLI 부트스트랩 import 가드                                                                                                                                                                             |
| 10   | `plugins:assets:copy`, `runtime-postbuild`, `build-stamp` | 후처리·스탬프                                                                                                                                                                                          |
| 11   | `write-plugin-sdk-entry-dts`, `check-plugin-sdk-exports`  | 플러그인 SDK 표면                                                                                                                                                                                      |
| 12   | **`ui:build`**                                            | Control UI. **캐시를 일부러 끈다** - 빌드 ID 가 package.json·git HEAD·env 에서 나와 파일 입력 해시로 무효화할 수 없고, 캐시 적중이 낡은 서비스워커를 복원할 수 있기 때문(`build-all.mts:145-152` 주석) |
| 13   | `write-build-info`, `write-cli-startup-metadata`          | 버전·헬프 텍스트 사전 계산                                                                                                                                                                             |

즉 **`pnpm build` 한 번이 백엔드와 Control UI 를 모두 굽는다.** `pnpm ui:build` 는 UI 만 다시 굽는 부분 명령이다.

### 6-2. `pnpm ui:build`

`node scripts/ui.js build` -> `scripts/ui.mts:393-394` 에서 `vite build` -> `ui/vite.config.ts:26` 의 `outDir = <repo>/dist/control-ui`. 산출물 검증은 `scripts/ui.mts:414-417`.

### 6-3. `pnpm check`

`node --import ./scripts/tsx.mjs scripts/check.mts` (219줄). 개별 pnpm 스크립트를 순차/병렬로 부른다. 주요 항목:

- 정적 가드: 충돌 마커, 스크립트 erasability, max-lines 래칫, assertion SAFETY 주석 래칫, changelog 기여자, "database-first" 레거시 스토어 가드, doctor deprecation 레지스트리, 미디어 다운로드 헬퍼, 런타임 사이드카 로더, opengrep 룰 메타데이터, npm lock, 패치 가드.
- 경계 가드: 플러그인 wildcard 재수출 금지, deprecated 채널 접근 금지, 웹훅 저수준 body 읽기 금지, temp 경로 가드, 페어링 스토어/계정 스코프 가드, import 사이클.
- 타입: `tsgo:prod`, `tsgo:scripts`, `tsgo:test:root` (또는 `tsgo:all`).
- 린트·포맷: `lint`, `format:check` (포매터는 `oxfmt`, 린터는 `oxlint` 계열).

FORK.md 10-2b 실측: **exit 0, 실패 0.**

### 6-4. `pnpm test`

`scripts/test-projects.mts` (5줄) 가 `scripts/lib/vitest-process.mts` 의 `runVitestCli("test", runTestProjects)` 를 부른다. 루트 `vitest.config.ts` 는 `test/vitest/vitest.config.ts` 를 재수출하고, 거기 `:97` 이 `projects: [...rootVitestProjects]` 로 **118개 vitest 프로젝트 설정**(`test/vitest/vitest.*.config.ts`)을 묶는다. 레인 예: `acp`, `agents-*`, `auto-reply-*`, `boundary`, `bundled`, `channel-*`, `gateway-core`, `ui`, `tooling`, `extension-*`.

실측(FORK.md 10-2b): 통과 192,671 / 실패 450, 그중 419건이 `jq` 미설치 하나. **새 환경에서는 `apt-get install -y jq` 를 먼저 하고, 레인만 볼 때도 `pnpm vitest` 직접 호출 대신 `pnpm test` 를 쓴다**(공식 러너가 temp/state 환경을 세팅한다).

그 밖의 테스트 진입점: `test:docker:*` 100개 이상(컨테이너 E2E), `test:live:*`(실제 모델 호출), `test:e2e:*`, `test:perf:*`, `test:startup:bench`.

### 6-5. 릴리스와 CI

- 릴리스 스크립트: `release:prep`, `release:version`, `release:candidate`, `release:beta`, `release:check`, `release:plugins:npm:plan`, `release:plugins:clawhub:plan`, `ci:full-release`.
- CI 워크플로 **101개** (`.github/workflows/`). 중심은 `ci.yml` (5,618줄). 러너는 조건부로 `ubuntu-24.04` 또는 blacksmith 4/8/32 vCPU 를 고른다(`ci.yml:98`). 잡 이름 예: `checks-fast-*`, `check-additional-*`, `check-sqlite-session-schema-baseline`, `checks-windows-node-test-*`, `macos-node-*`, `android-test-play`.
- 그 밖: `docker-release.yml`, `docker-image-refresh.yml`, `codeql*.yml`(4개), `dependency-audit.yml`, `dependency-guard.yml`, `install-smoke.yml`, `node22-compat.yml`, 플랫폼별 릴리스 워크플로.
- **포크 주의**: gh 토큰에 `workflow` 스코프가 없으면 `.github/workflows/` 를 건드리는 push 가 거부된다(FORK.md 3-1 에 우회 절차).

---

## 7. 확장 지점

### 7-1. `extensions/` 153개

`ls -d extensions/*/ | wc -l` = **153** (그중 `package.json` 보유 149개. `active-memory`·`device-pair`·`talk-voice`·`test-support` 는 매니페스트 없이 형제 플러그인/테스트 픽스처에 흡수돼 있다).

분류는 (a) `package.json` 의 `openclaw.channel` 블록, (b) 코드가 실제로 부르는 `api.register*` 로 판정했다.

| 분류                                          | 개수 | 예                                                                                                                                                                                                                                       |
| --------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **채널**                                      | 27   | telegram, slack, discord, msteams, matrix, signal, whatsapp, line, imessage, irc, mattermost, nostr, feishu, googlechat, twitch, sms, zalo, zalouser, synology-chat, nextcloud-talk, tlon, a2a, buzz, clickclack, raft, reef, qa-channel |
| **모델 프로바이더**                           | 62   | anthropic, openai, google, xai, ollama, lmstudio, vllm, sglang, llama-cpp, openrouter, groq, cerebras, deepseek, mistral, minimax, moonshot, qwen, zai, amazon-bedrock, github-copilot, litellm, clawrouter, vercel-ai-gateway 외        |
| **미디어(TTS/STT/이미지/비디오)**             | 11   | elevenlabs, azure-speech, microsoft, inworld, gradium, fish-audio-speech, deepgram, senseaudio, tts-local-cli, image-generation-core, document-extract                                                                                   |
| **도구**                                      | 19   | browser, canvas, workboard, memory-wiki, firecrawl, brave, tavily, exa, perplexity, searxng, duckduckgo, onepassword, google-meet, voice-call, file-transfer, diffs, lobster, parallel, visitor-access, qa-lab                           |
| **메모리**                                    | 3    | memory-core, memory-lancedb, voyage(임베딩 전용)                                                                                                                                                                                         |
| **인프라(서비스/HTTP/게이트웨이 메서드/CLI)** | 16   | acpx, admin-http-rpc, beam, device-pair, diagnostics-otel, diagnostics-prometheus, geolocation, imap, logbook, oc-path, policy, vault, webhooks, teams-meetings, zoom-meetings, diffs-language-pack                                      |
| **기타**                                      | 15   | **codex·copilot(에이전트 하네스)**, mxc·openshell(샌드박스 백엔드), bonjour, cua-computer, linux-node, llm-task, migrate-claude, migrate-hermes, tokenjuice, web-readability, active-memory, talk-voice, test-support                    |

실제 로컬 인스턴스에서 로드된 것은 **16개**다(FORK.md 10-2: acpx, browser, canvas, cua-computer, device-pair, file-transfer, geolocation, google-meet, linux-node, memory-core, ollama, openai, talk-voice, teams-meetings, xai, zoom-meetings). 즉 **저장소에 있다고 다 켜지는 게 아니라 설정으로 고른다.**

### 7-2. 플러그인 SDK

- `packages/plugin-sdk` 는 **`src/plugin-sdk` 를 그대로 재수출하는 얇은 파사드**다(`packages/plugin-sdk/src/plugin-entry.ts:3` 등이 전부 `export * from "../../../src/plugin-sdk/<x>.js"`).
- **루트 `"."` export 가 없다.** 작성자는 서브패스를 골라 import 해야 한다(선언된 서브패스 57개).

| 서브패스                                    | 진입 함수                                                                                              | 용도                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `openclaw/plugin-sdk/plugin-entry`          | `definePluginEntry(...)` (`src/plugin-sdk/plugin-entry.ts:233`, 옵션 타입 `:202-217`)                  | 채널이 아닌 모든 플러그인       |
| `openclaw/plugin-sdk/core`                  | `defineChannelPluginEntry(...)` (`src/plugin-sdk/core.ts:553`), `defineSetupPluginEntry(...)` (`:601`) | 채널 플러그인                   |
| `openclaw/plugin-sdk/provider-entry`        | `defineSingleProviderPluginEntry(...)`                                                                 | 단일 모델 프로바이더            |
| `openclaw/plugin-sdk/provider-model-shared` | `defineSelfHostedOpenAICompatibleProvider(...)`                                                        | OpenAI 호환 셀프호스트(vllm 등) |

**등록 API 표면** `OpenClawPluginApi` 는 `src/plugins/plugin-api.types.ts` 에 있다. 자주 쓰는 것:

| 훅                                                                                                   | 줄                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| `registerChannel`                                                                                    | `:226`                            |
| `registerProvider`                                                                                   | `:278`                            |
| `registerTool`                                                                                       | `:208`                            |
| `registerHook`                                                                                       | `:212`                            |
| `registerMemoryCapability`                                                                           | `:447`                            |
| `registerEmbeddingProvider`                                                                          | `:284`                            |
| `registerSpeechProvider` / `registerRealtimeTranscriptionProvider` / `registerRealtimeVoiceProvider` | `:288` / `:290` / `:292`          |
| `registerImageGenerationProvider` / `Video` / `Music`                                                | `:298` / `:300` / `:302`          |
| `registerWebFetchProvider` / `registerWebSearchProvider`                                             | `:304` / `:306`                   |
| `registerCommand` / `registerService` / `registerHttpRoute` / `registerGatewayMethod`                | `:316` / `:264` / `:217` / `:234` |
| `registerAgentHarness`                                                                               | `:324`                            |
| `registerContextEngine`                                                                              | `:318`                            |
| `registerCliBackend`                                                                                 | `:268`                            |
| `registerControlUiDescriptor` / `registerWidgetPresenter`                                            | `:140` / `:221`                   |

배타적 플러그인 `kind` 는 `"memory" | "context-engine"` 둘뿐이다(`src/plugins/plugin-kind.types.ts:2`, 매니페스트 파싱 `src/plugins/manifest.ts:39-52,214`).

**외부 플러그인 package.json 계약** (`packages/plugin-package-contract/src/index.ts`): 필수 필드 경로는 `openclaw.compat.pluginApi` 와 `openclaw.build.openclawVersion` 둘(`:28-31`). 검증 함수 `validateExternalCodePluginPackageJson(...)` (`:95`) 이 `{ compatibility, issues[] }` 를 돌려준다. 실제 예: `extensions/slack/package.json` 의 `openclaw.compat.pluginApi: ">=2026.9.2"`, `openclaw.install.minHostVersion: ">=2026.5.28"`, `openclaw.release.publishToClawHub: true`.

### 7-3. 훅

세 층이다.

**(1) 내부(in-process) 훅** - `src/hooks/internal-hooks.ts`: `registerInternalHook(eventKey, handler)`(`:214`), `triggerInternalHook(event)`(`:284`).

이벤트 패밀리는 `"command" | "session" | "agent" | "gateway" | "message"` (`src/hooks/internal-hook-types.ts:2-9`).

알려진 이벤트 키(`:20-36`): `agent:bootstrap`, `command:new`, `command:reset`, `command:stop`, `gateway:pre-restart`, `gateway:shutdown`, `gateway:startup`, `message:preprocessed`, `message:received`, `message:sent`, `message:transcribed`, `session:auto-reset`, `session:compact:after`, `session:compact:before`, `session:patch`. 패밀리 키만 구독하면 그 패밀리 전체를 받는다(`:14-16`).

**(2) 파일 훅** - 디렉터리에 `HOOK.md` + `handler.ts`(`src/hooks/types.ts:37-44`). frontmatter 에 **`events: string[]` 필수**(`:2-29`). 소스는 `openclaw-bundled | openclaw-managed | openclaw-workspace | openclaw-plugin`(`:41`). 로더 `src/hooks/loader.ts:51` `prepareInternalHooks()`, 설정 게이트 `cfg.hooks.internal.enabled !== false`(`:59`). 번들 예: `src/hooks/bundled/command-logger/`.

**(3) 플러그인 훅** - `api.registerHook(...)` (`src/plugins/plugin-api.types.ts:212`), 구현 `src/plugins/plugin-hooks.ts`.

---

## 8. 커스터마이즈 가이드 - 고치고 싶을 때 어디를 보나

| 하고 싶은 것                        | 손댈 곳                                                                                                                                                                                                     | 주의                                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **탭 제목(정적 부팅)**              | `ui/index.html` 의 `<title>`                                                                                                                                                                                | 번들 로드 전 표시되는 값                                                                                                                                                   |
| **번들 기동 실패 화면 라벨**        | `ui/index.html` `.mount-fallback__eyebrow` (`:367`)                                                                                                                                                         |                                                                                                                                                                            |
| **About 페이지 제품명**             | `ui/src/i18n/locales/en.ts:3195` `aboutPage.productName`                                                                                                                                                    | en 이 원본, 나머지 20개는 번역                                                                                                                                             |
| **승인 화면 브랜드명**              | `ui/src/i18n/locales/en.ts:1916` `approvalPage.brandName`                                                                                                                                                   |                                                                                                                                                                            |
| **런타임 탭 제목 접미사**           | `ui/src/app-navigation.ts` `formatDocumentTitle()` 의 하드코딩 `"OpenClaw"`                                                                                                                                 | **i18n 키가 아니다.** `app-host.document-title.test.ts`·`app-navigation.test.ts` 가 이 문자열을 단언하므로 같이 고쳐야 한다                                                |
| **상단바 브랜드**                   | `ui/src/components/app-topbar.ts:39,46` (`aria-label`, `.topbar-brand__title`)                                                                                                                              |                                                                                                                                                                            |
| **색상 토큰**                       | `ui/src/styles/base.css:1-80` (`--bg`, `--text`, `--accent` 등)                                                                                                                                             | `base-theme-contrast.node.test.ts` 가 대비를 단언한다                                                                                                                      |
| **첫 페인트 테마(FOUC 방지)**       | `ui/index.html:24-36`(THEMES), `:68-79`(FAMILIES), `:113-209`(테마별 배경)                                                                                                                                  | **`ui/src/app/theme.ts` 와 반드시 동기화**해야 한다                                                                                                                        |
| **추가 테마 팔레트**                | `ui/public/themes/*.css` (10종)                                                                                                                                                                             |                                                                                                                                                                            |
| **로고·파비콘·아트워크**            | `ui/public/favicon.svg`, `favicon-32.png`, `favicon.ico`, `apple-touch-icon.png`, `manifest.webmanifest`, `app-art/*.webp`                                                                                  | **상표 영역.** 이 포크는 건드리지 않았다                                                                                                                                   |
| **새 채널 추가**                    | `extensions/<name>/` 생성 -> `package.json` 에 `openclaw.channel` -> `defineChannelPluginEntry`(`src/plugin-sdk/core.ts:553`) -> `ChannelPlugin`(`src/channels/plugins/types.plugin.ts:60`) 구현            | 참고 구현은 `extensions/slack/`(가장 표준적)                                                                                                                               |
| **새 모델 프로바이더 추가**         | `extensions/<name>/` -> `defineSingleProviderPluginEntry` 또는 `defineSelfHostedOpenAICompatibleProvider` -> `ProviderPlugin`(`src/plugins/provider-plugin.types.ts:93`). 매니페스트에 `openclaw.providers` | 스캐폴드 스킬 있음: `custodian-skills/add-model-provider/`. AGENTS.md 는 "프로바이더 모델 변경은 소유 플러그인 매니페스트를 고치고 카탈로그 발행 워크플로를 돌려라"고 규정 |
| **게이트웨이 API 추가**             | 코어면 `src/gateway/server-methods/` 에 핸들러 + `methods/core-descriptors.ts` 등록. 플러그인이면 `api.registerGatewayMethod`(`plugin-api.types.ts:234`)                                                    | `pnpm check:protocol-coverage` 가 커버리지를 본다. **플러그인의 `registerHttpRoute` 는 린트로 제약된다**(`lint:plugins:no-register-http-handler`)                          |
| **메모리 로직 변경**                | 기본 구현 `extensions/memory-core/src/memory/` (동기화·KNN·리셋), 스키마·FTS·임베딩은 `packages/memory-host-sdk/src/host/`, 설정 타입 `src/config/types.memory.ts`                                          | 벡터는 `sqlite-vec` 확장 로드가 전제(`sqlite-vec.ts:58-90`)                                                                                                                |
| **기본 프롬프트(시스템 프롬프트)**  | `src/agents/system-prompt.ts`                                                                                                                                                                               | 스냅샷 테스트가 있다: `pnpm prompt:snapshots:check` / `:gen`, CI 잡 `check-prompt-snapshots`                                                                               |
| **워크스페이스 `AGENTS.md` 템플릿** | 워크스페이스 경로는 `src/agents/workspace-default.ts:14-34`. 부트스트랩 해시 테이블 `workspace_generated_bootstrap_hashes`                                                                                  |                                                                                                                                                                            |
| **설정 스키마 추가**                | `src/config/types.*.ts` -> `pnpm config:schema:gen` / `config:docs:gen` -> `check:base-config-schema`·`config:schema:check` 통과                                                                            | 설정 파일은 JSON5                                                                                                                                                          |
| **DB 테이블 추가**                  | 4-2 절의 5단계                                                                                                                                                                                              |                                                                                                                                                                            |
| **CLI 명령 추가**                   | `src/cli/program/register*.ts` + `src/cli/*-cli.ts`. 헬프 텍스트는 빌드 시 사전 계산됨(`scripts/write-cli-startup-metadata.ts`)                                                                             |                                                                                                                                                                            |
| **스킬 추가**                       | `skills/<name>/SKILL.md` (frontmatter `name`·`description` 필수)                                                                                                                                            | 스킬 작성 스킬: `skills/skill-creator/`                                                                                                                                    |
| **훅 추가**                         | `src/hooks/bundled/<name>/{HOOK.md,handler.ts}` 또는 플러그인의 `api.registerHook`                                                                                                                          | `HOOK.md` frontmatter 의 `events` 필수                                                                                                                                     |

### 8-1. 이 포크의 커스터마이즈 커밋 (`864d892`) 이 실제로 건드린 것

```
feat(ui): mark Control UI as the Chris fork
 ui/index.html             | 4 ++--
 ui/src/i18n/locales/en.ts | 2 +-
 2 files changed, 3 insertions(+), 3 deletions(-)
```

세 문자열만 바꿨다: `ui/index.html` 의 `<title>`, 같은 파일의 mount-fallback 라벨, `ui/src/i18n/locales/en.ts` 의 `aboutPage.productName`. **로고·마스코트·아이콘 에셋은 하나도 바꾸지 않았다**(커밋 메시지에 상표 주의가 명시돼 있다).

이 커밋이 말해 주는 것: **제품명 문자열이 한 곳에 모여 있지 않다.** 정적 HTML(부팅 전), i18n 카탈로그(런타임), 그리고 `app-navigation.ts` 의 하드코딩 상수(테스트가 단언) 세 곳으로 흩어져 있다. 진짜 화이트라벨을 하려면 세 번째를 i18n 키로 빼고 관련 테스트 두 개를 함께 고쳐야 한다(FORK.md 5장의 "교훈").

---

## 9. 확인하지 못한 것

정직하게 남긴다.

- **업스트림 CI 실행 결과와 대조하지 못했다.** 포크 CI 를 돌리려면 gh 토큰의 `workflow` 스코프가 필요한데 이 환경에서 얻지 못했다(FORK.md 3-1).
- **`apps/` 네이티브 앱을 빌드해 보지 않았다.** 스택 판정은 빌드 파일(`Package.swift`·`build.gradle.kts`·`Cargo.toml`·`project.yml`) 근거이고, Xcode·Android SDK·Rust 툴체인이 이 PC 에 없어 실제 빌드는 못 했다.
- **`extensions/` 153개 전부를 실행해 보지 않았다.** 분류는 매니페스트와 `api.register*` 호출 근거이고, 실제로 로드해 확인한 것은 로컬 인스턴스의 16개다.
- Docker 이미지 레이어 breakdown 은 `docker history` 의 요약이라 압축 전후·공유 레이어를 정밀 분해한 것은 아니다. 합계 4.37GB 와 `node_modules` 2.65GB 는 그대로 실측값이다.

---

## 10. 참고

- 이 포크의 운영 정본: [FORK.md](../FORK.md)
- 업스트림 문서: `docs/` (751개). 특히 `docs/reference/database-schemas.md`, `docs/agent-runtime-architecture.md`, `docs/automation/hooks.md`
- 기여자 규칙: `AGENTS.md` (362줄, 서브트리마다 별도 `AGENTS.md` 존재), `CONTRIBUTING.md`
- chris-server 레포 요약: `knowledge/development/openclaw-fork.md`
- 홈랩 운영 인스턴스(claw01) 인프라 정리: chris-server `homelab/openclaw/architecture.html`
