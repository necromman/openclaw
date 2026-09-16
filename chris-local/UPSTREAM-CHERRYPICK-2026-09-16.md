# 업스트림 v2026.9.2 -> v2026.9.4 체리픽 후보 분류 (2026-09-16)

- 대상 범위: `v2026.9.2..v2026.9.4` (커밋 3,439개, 전부 squash 커밋). 포크 기준 브랜치 `chris/main`.
- 입력: 체인지로그 9.3 Changes/Fixes, 체인지로그 9.4 `Security and Privacy` 전문 + 나머지 15개 대주제의 Bug fixes/Security 소항목, `git log --format='%h %s' v2026.9.2..v2026.9.4`.
- 판단 기준은 요청서의 A(보안 전부), B(핵심 버그), C(성능), D(제외)를 그대로 따랐다.
- "포크 겹침"은 `git diff --name-only main chris/main` 으로 뽑은 포크 수정 파일 856개(`chris-local/`, `ix-auth/`, `.claude/` 제외)와 각 커밋의 변경 파일 교집합이다. 겹침이 있으면 체리픽 시 충돌 가능성이 높다는 뜻이고, 없다고 해서 무충돌이 보장되지는 않는다.

## 1. 요약

| 카테고리 | 건수 | 내용 |
|---|---|---|
| A 보안 | 46 | 9.4 `Security and Privacy` 전 항목 + 9.3 Fixes 의 보안 항목 + 커밋 메시지 보안 grep(169건 후보) 중 실제 보안으로 판정한 것 |
| B 핵심 버그 수정 | 99 | gateway(인증·세션·채팅·WS), agents 런타임, memory, cron, control UI, config 로딩, SQLite/DB, 업데이트 안전화 |
| C 성능 | 36 | 프롬프트 캐시 보존 11건, 콜드 세션·메모리 검색 작업 제거, 메인 스레드 오프로딩 |
| A+B+C 합계 | 181 | 부록의 체리픽 순서대로 적용 |
| D 제외 | 나머지 3,258 | 신규 기능, Breaking 변경, macOS/iOS/Android 앱, 문서 전용, 채널 플러그인 단독 수정, CI/릴리스 |

겹침 요약:

- A 46건 중 9건이 포크 수정 파일과 겹친다. 그중 `src/gateway/auth.ts` 를 건드리는 것이 2건(#139844, #141720)으로 IX-Auth 연동 코드와 직접 충돌한다.
- `config/assertion-safety-baseline.txt` 와 `docs/.generated/config-baseline.*` 는 생성물이라 충돌하더라도 재생성으로 해결된다.

적용 순서 주의:

- 대형 커밋 몇 개가 사실상 시리즈의 베이스다. `#140579`(132파일), `#138839`(134파일), `#141477`(103파일), `#139911`(425파일), `#140859`(75파일), `#139465`(74파일)는 단독 체리픽이 거의 불가능하고, 앞뒤 커밋을 같이 가져가거나 수동 포팅해야 한다.
- 업데이트 안전화 묶음(#138839, #139722, #139709, #141562, #142817)은 순서대로 적용해야 한다.
- 이 포크는 푸시가 곧 배포이므로, A 를 먼저 한 묶음으로 올리고 B 와 C 는 나눠서 올리는 편이 안전하다.

## A. 보안 (46건)

| sha | PR | 제목(원문) | 설명 | 파일수/규모 | 비고 |
|---|---|---|---|---|---|
| `d7a1753b9f5` | #139056 | fix: retain proxy DNS checks with Undici security updates | Undici 보안 업데이트 후에도 프록시 DNS 재검증(SSRF 방어)이 계속 동작하도록 복구 | 18 files changed, 91 insertions(+), 56 deletions(-) | 포크 겹침 5건: extensions/anthropic-vertex/package.json, extensions/browser/package.json, extensions/discord/package.json |
| `12a3b102f50` | #136623 | fix(agents): bound grep JSON record intake | grep 도구의 JSON 레코드 입력량을 제한해 거대 결과로 인한 메모리 고갈(DoS) 방지 | 2 files changed, 270 insertions(+), 9 deletions(-) | - |
| `e731a1b7f4f` | #139142 | fix(plugin-sdk): harden account scope for pairing requests and challenges | 페어링 요청·챌린지의 계정 스코프를 강화해 다른 계정 자격으로의 페어링 시도 차단 | 4 files changed, 144 insertions(+), 10 deletions(-) | - |
| `a3cb57962cf` | #139332 | fix(config): preserve writer origin in config audit history | 설정 감사 원장에 실제 작성자 출처를 보존(감사 위·변조 방지) | 3 files changed, 98 insertions(+), 78 deletions(-) | - |
| `1c7a73f3199` | #139337 | fix(config): preserve sensitivity and URL redaction metadata | 설정 응답에서 민감 필드·URL 레닥션 메타데이터를 보존해 시크릿 평문 노출 차단 | 9 files changed, 287 insertions(+), 108 deletions(-) | - |
| `baacbbeaf60` | #139387 | perf(gateway): use secure scratch root for worker preparation | 워커 준비용 스크래치 루트를 안전한 전용 경로로 옮겨 공용 temp 경유 탈취 위험 제거 | 9 files changed, 38 insertions(+), 21 deletions(-) | - |
| `9f225f5333e` | #139368 | fix(plugins): align subagent override authorization with execution | 서브에이전트 오버라이드의 인가 판정을 실제 실행 경로와 일치시켜 권한 상승 차단 | 5 files changed, 258 insertions(+), 60 deletions(-) | - |
| `d6eba6c0ca1` | #139536 | fix(config): preserve plugin secret references in Settings saves | Settings 저장 시 플러그인 시크릿 참조가 평문으로 덮어써지지 않게 보존 | 6 files changed, 155 insertions(+), 2 deletions(-) | 포크 겹침 1건: docs/.generated/config-baseline.sha256 |
| `51be20280b5` | #139421 | fix(gateway): reconcile pairing lifecycle after token removal | 토큰 삭제 후 페어링 수명주기를 정리해 폐기된 기기 항목이 남는 문제 해결 | 9 files changed, 1186 insertions(+), 1154 deletions(-) | - |
| `4a9a0914b72` | #139844 | fix: reject and repair placeholder Gateway tokens | 플레이스홀더 Gateway 토큰을 거부·복구(기본값 토큰으로 인증 우회 차단) | 17 files changed, 441 insertions(+), 189 deletions(-) | 포크 겹침 1건: src/gateway/auth.ts |
| `811eb132a18` | #127216 | fix(microsoft-foundry): bound Entra token retention across accounts | Entra 토큰의 계정 간 보존 범위를 제한해 토큰 혼선·누수 방지 | 2 files changed, 278 insertions(+) | - |
| `7ff0e11c1f9` | #129144 | fix(talk): keep opaque realtime routes out of public config | 불투명 realtime 라우트를 공개 설정·카탈로그 투영에서 제외(내부 엔드포인트 노출 차단) | 64 files changed, 3543 insertions(+), 1414 deletions(-) | 포크 겹침 2건: config/assertion-safety-baseline.txt, ui/src/i18n/locales/en.ts |
| `0bca64f26ab` | #140381 | fix(memory): report skipped symlink roots in status | 메모리 색인이 건너뛴 심링크 루트를 상태에 보고(심링크 경유 색인 이탈 가시화) | 4 files changed, 108 insertions(+), 5 deletions(-) | - |
| `2d0d99fe08d` | #140859 | fix: distinguish inbound messages from runtime context | 사용자 입력과 게이트웨이 런타임 컨텍스트를 분리해 내부 컨텍스트가 채널로 새지 않게 함 | 75 files changed, 1504 insertions(+), 1746 deletions(-) | 포크 겹침 2건: src/agents/command/prepare.ts, src/gateway/server-methods/client-types.ts |
| `0c9330b4c34` | #140903 | fix(diagnostics-prometheus): reject unauthorized metric scrapes | Prometheus 메트릭 스크레이프에 운영자 읽기 권한을 요구(무인증 지표 수집 차단) | 6 files changed, 207 insertions(+), 7 deletions(-) | - |
| `094afc92581` | #133843 | fix(secrets): warn on shared auth-profile plaintext in configure | 공유 auth 프로필에 남은 평문 시크릿을 configure 단계에서 경고 | 3 files changed, 335 insertions(+), 2 deletions(-) | - |
| `841694048e1` | #140873 | fix(codex): redact credentials in dynamic tool text results | Codex 동적 도구 텍스트 결과에서 자격증명을 레닥션 | 3 files changed, 199 insertions(+), 1 deletion(-) | - |
| `91c864ca19b` | #141247 | fix: keep active sessions scoped to their agent | 활성 세션 목록을 소유 에이전트 범위로 제한(에이전트·부서 경계 누수 차단) | 22 files changed, 336 insertions(+), 32 deletions(-) | - |
| `cf65773dcc0` | #139604 | fix(agents): strip wrapped runtime-context prefaces from delivered text | 전달 텍스트에서 래핑된 런타임 컨텍스트 서문을 제거(내부 프롬프트 노출 차단) | 3 files changed, 67 insertions(+), 29 deletions(-) | - |
| `7cab04806c9` | #141086 | fix(file-transfer): authorize admitted archive identities in directory policy | 파일 전송 디렉터리 정책에서 허용된 아카이브 신원만 인가(경로·신원 우회 차단) | 23 files changed, 1106 insertions(+), 983 deletions(-) | - |
| `2994c201996` | #141421 | fix(mcp): fetched prompts lose image content | MCP 프롬프트 응답을 타입 검증해 외부 서버의 임의 값 주입 차단 | 7 files changed, 198 insertions(+), 115 deletions(-) | - |
| `e57e375a402` | #141471 | fix(agents): honor exec allowlists for Claude native Bash | Claude 네이티브 Bash 명령에 exec 허용목록을 적용(승인 우회 차단) | 10 files changed, 409 insertions(+), 124 deletions(-) | - |
| `7ac87c0a461` | #141484 | fix(secrets): keep protected HTTPS working beyond one day | 보호 HTTPS 리프 인증서를 하루 이상 유지되게 갱신하고 실패를 상태·Doctor 에 보고 | 17 files changed, 450 insertions(+), 95 deletions(-) | - |
| `59f57f3cc5f` | #141544 | fix: hide internal context in streamed reasoning previews | 스트리밍 추론 미리보기에서 내부 컨텍스트를 숨김(부분 스트림 마커 포함) | 8 files changed, 220 insertions(+), 38 deletions(-) | - |
| `b3589c4248a` | #141720 | fix(gateway): reject invalid password secrets at startup | 빈 값·예시 값 Gateway 비밀번호를 시작 시 거부하고 강도를 감사 | 13 files changed, 225 insertions(+), 167 deletions(-) | 포크 겹침 1건: src/gateway/auth.ts |
| `9a5ba678d99` | #141960 | fix(agents): bound QuickJS guest recursion | QuickJS 게스트 재귀 깊이를 제한해 샌드박스 스택 고갈(DoS) 방지 | 2 files changed, 59 insertions(+), 1 deletion(-) | - |
| `aefcc525bac` | #142130 | fix(gateway): trash deleted-agent files from state dirs outside home and tmp | 홈·temp 밖 state 디렉터리의 삭제 에이전트 파일 처리(심링크 포함 삭제 범위 정정) | 4 files changed, 154 insertions(+), 34 deletions(-) | 포크 겹침 1건: src/gateway/server-methods/agents.ts |
| `8d0d9e9a08d` | #142074 | fix(cron): run scheduled commands with secret egress enabled | 예약 실행 명령이 관리형 시크릿 egress 를 켠 상태로 돌도록 수정 | 7 files changed, 370 insertions(+), 38 deletions(-) | - |
| `f9ea6dbb69c` | #142158 | feat(models): scope implicit catalogs to configured provider endpoints | 암묵 카탈로그를 설정된 provider 엔드포인트로 한정(임의 원격지 조회 차단) | 20 files changed, 753 insertions(+), 66 deletions(-) | - |
| `8d79c6ab2c3` | #137684 | fix(ssrf): keep IPv6 metadata blocked under ULA opt-in | ULA 옵트인 상태에서도 IPv6 클라우드 메타데이터 차단 유지(SSRF) | 4 files changed, 40 insertions(+), 1 deletion(-) | - |
| `b824b72ce28` | #141477 | fix(auth): fence shared OAuth refresh generations | 공유 OAuth 리프레시 세대를 펜싱해 동시 갱신 시 토큰 무효화·혼선 방지 | 103 files changed, 9927 insertions(+), 1526 deletions(-) | 포크 겹침 1건: test/scripts/lint-suppressions.test.ts |
| `c11ea06355b` | #136508 | fix(slack): bound HTTP bodies before Bolt | Slack HTTP 웹훅 본문을 Bolt 이전에 1 MiB·30초로 제한(대용량·저속 요청 DoS 방어) | 5 files changed, 361 insertions(+), 28 deletions(-) | - |
| `7069a4772ff` | #137668 | fix(gateway): honor mapped IPv4 CIDR ranges | IPv4 매핑 CIDR 범위를 신뢰 프록시·페어링 규칙에 정확히 적용(과다·과소 신뢰 정정) | 5 files changed, 68 insertions(+), 2 deletions(-) | - |
| `97e1985d0e4` | #142557 | fix(models): harden SDK catalog loads with passive defaults | SDK 카탈로그 로드를 수동 기본값으로 굳혀 외부 카탈로그의 능동 동작 차단 | 5 files changed, 85 insertions(+), 18 deletions(-) | - |
| `2d1dfeab758` | #142589 | fix(security): preserve existing WhatsApp group allowlists | security audit --fix 가 기존 WhatsApp 그룹 허용목록을 덮어쓰지 않게 보존 | 4 files changed, 116 insertions(+), 5 deletions(-) | - |
| `959854ce735` | #142041 | fix(tlon): prevent citations from fetching outside the cited post | Tlon 인용이 인용 대상 밖을 조회하지 못하게 차단(인증된 조회 전 검증) | 3 files changed, 186 insertions(+), 14 deletions(-) | - |
| `64ef483a100` | #142873 | fix(auth): preserve device-code verification link boundaries | device-code 검증 링크 경계를 보존해 링크 변조·오인 유도 방지 | 6 files changed, 93 insertions(+), 56 deletions(-) | - |
| `9bf06f7cc0f` | #142093 | fix(agents): preserve disabled tools at plugin handoff | 플러그인 핸드오프 시 비활성화된 도구 목록을 보존(도구 차단 우회 방지) | 5 files changed, 911 insertions(+), 7 deletions(-) | - |
| `3bd8ec2b39b` | #142661 | Fix MCP App standalone ticket authority | 독립 창 MCP App 에서 읽기 전용 권한을 유지(티켓으로 도구 실행 권한 상승 차단) | 8 files changed, 308 insertions(+), 13 deletions(-) | - |
| `cc81bfade70` | #143308 | fix: retain exec review resources after timeout | 명령 자동 검토가 타임아웃돼도 리소스를 정리 완료까지 유지 | 6 files changed, 433 insertions(+), 95 deletions(-) | - |
| `1a6d46b02ab` | #143724 | fix(gateway): stop pipelined MCP calls after rejected uploads | 업로드 거부 후 같은 인증 루프백 연결에 파이프라인된 MCP 호출 실행 차단 | 4 files changed, 155 insertions(+), 123 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `088b3471ada` | #143799 | fix(backup): exclude private update captures from ordinary exports | 백업·지원 번들에서 비공개 업데이트 캡처를 제외 | 10 files changed, 353 insertions(+), 4 deletions(-) | - |
| `0669f6b2c5b` | #143873 | fix(gateway): honor draft visibility for artifact reads | 공유 대화를 초안으로 되돌리면 새 아티팩트 읽기·다운로드도 차단 | 3 files changed, 231 insertions(+), 51 deletions(-) | - |
| `0670cd25c26` | #143899 | fix: keep moved capture directories out of exports | 마커가 유지된 이동된 비공개 캡처 디렉터리를 내보내기에서 제외하고 잘못된 마커는 거부 | 10 files changed, 636 insertions(+), 21 deletions(-) | - |
| `fdf711c862c` | #143521 | fix(media): isolate agent sandbox roots | 에이전트 샌드박스 루트를 격리해 형제 세션 샌드박스의 첨부 읽기 차단 | 10 files changed, 228 insertions(+), 23 deletions(-) | - |
| `f78e6ed29f9` | #143484 | fix(feishu): reject replayed webhook callbacks with stale signed timestamps | 서명 타임스탬프가 1시간 창을 벗어난 Feishu·Lark 웹훅 콜백 재전송 거부 | 7 files changed, 133 insertions(+), 2 deletions(-) | - |

## B. 핵심 버그 수정 (99건)

| sha | PR | 제목(원문) | 설명 | 파일수/규모 | 비고 |
|---|---|---|---|---|---|
| `5a17ad0e0e2` | #139051 | fix(gateway): release writer during inbound worktree restore | 인바운드 워크트리 복원 중 DB 라이터를 놓아 세션 쓰기 정지 해소 | 4 files changed, 258 insertions(+), 56 deletions(-) | - |
| `140eb569a0b` | #139002 | fix(sessions): make input relocation transaction-safe | 세션 입력 재배치를 트랜잭션 안전하게 처리(중단 시 입력 유실 방지) | 8 files changed, 390 insertions(+), 52 deletions(-) | - |
| `91095dcd9bf` | #138964 | fix(control-ui): recover bundled startup without losing sign-in | 번들 Control UI 시작 실패를 로그인 상태 손실 없이 복구 | 28 files changed, 1447 insertions(+), 560 deletions(-) | 포크 겹침 2건: ui/src/app/app-host.gateway-lineage.test.ts, ui/src/app/app-root.ts |
| `bf7ccd6f191` | #136589 | fix(cron): preserve scheduled report images in conversation history | 예약 리포트 이미지가 대화 기록에 보존되도록 수정 | 9 files changed, 650 insertions(+), 63 deletions(-) | - |
| `bcf699c2b9b` | #139085 | fix(sqlite): release cached statement with its database owner | SQLite 준비 statement 를 소유 DB 와 함께 해제(핸들 누수·크래시 방지) | 2 files changed, 67 insertions(+), 5 deletions(-) | - |
| `a9f5e448323` | #139136 | fix(sqlite): retain malformed database diagnostics | 손상 DB 진단 정보를 유지해 원인 파악 가능하게 함 | 6 files changed, 56 insertions(+), 45 deletions(-) | - |
| `834c7c0487e` | #139130 | fix(sessions): avoid cross-agent global initialization blocks | 에이전트 간 전역 초기화 잠금 충돌 제거 | 2 files changed, 55 insertions(+) | - |
| `2c75b75f0d8` | #139114 | fix(sessions): release writer during worktree restoration | 워크트리 복원 중 라이터를 놓아 세션 변경이 멈추지 않게 함 | 9 files changed, 864 insertions(+), 388 deletions(-) | 포크 겹침 2건: src/gateway/server-methods.authorization.test.ts, src/gateway/server-methods/sessions-mutations.ts |
| `707edba619a` | #139192 | fix(gateway): keep chat metadata responsive across auth refresh | 인증 갱신 중에도 채팅 메타데이터 응답 유지 | 5 files changed, 401 insertions(+), 34 deletions(-) | - |
| `d0137988844` | #139203 | fix(config): return the saved configuration after plugin install commits | 플러그인 설치 커밋 후 실제 저장된 설정을 반환 | 3 files changed, 42 insertions(+), 8 deletions(-) | - |
| `426ca0d50f3` | #139092 | fix(gateway): stop admitting post-ready producers during close | 종료 중 준비 완료 이후 producer 유입을 차단해 셧다운 경합 제거 | 2 files changed, 358 insertions(+), 55 deletions(-) | - |
| `df804fc6ff4` | #134198 | fix(config): do not claim rejected payload saved when sidecar write fails | 사이드카 쓰기 실패 시 거부된 페이로드를 저장됐다고 보고하지 않음 | 3 files changed, 91 insertions(+), 47 deletions(-) | - |
| `43590115324` | #139061 | fix(gateway): avoid crashes when an upgrading client disconnects | 업그레이드 중 클라이언트가 끊길 때 게이트웨이 크래시 방지 | 4 files changed, 160 insertions(+), 52 deletions(-) | - |
| `feda3963485` | #139304 | fix(gateway): drain update notice work before shutdown | 셧다운 전에 업데이트 공지 작업을 배출 | 6 files changed, 124 insertions(+), 32 deletions(-) | - |
| `31fddf425fe` | #139393 | fix(update): report launchd service recovery correctly after a failed update | 실패한 업데이트 후 launchd 서비스 복구 결과를 정확히 보고 | 9 files changed, 181 insertions(+), 70 deletions(-) | - |
| `64a7abd6dfd` | #139463 | fix(memory): index notes when optional embeddings cannot start | 선택적 임베딩이 뜨지 않아도 노트 색인 진행 | 4 files changed, 66 insertions(+), 15 deletions(-) | - |
| `53802447f8c` | #139500 | fix(gateway): prevent shutdown hanging during suspension | 서스펜드 중 셧다운이 매달리는 문제 해결 | 7 files changed, 488 insertions(+), 223 deletions(-) | - |
| `26178af8147` | #139509 | fix(gateway): converge monitors after config publication | 설정 반영 후 모니터 상태를 수렴 | 8 files changed, 558 insertions(+), 170 deletions(-) | - |
| `425c6945a69` | #139516 | fix(gateway): deliver upgrade rejection responses under Bun | Bun 에서 업그레이드 거부 응답이 전달되게 수정 | 5 files changed, 108 insertions(+), 49 deletions(-) | - |
| `4f1bfcae70a` | #139469 | fix(sessions): prevent database lock failures during reclamation | 세션 회수 중 DB 잠금 실패 방지 | 11 files changed, 538 insertions(+), 206 deletions(-) | - |
| `2a77ac90956` | #139439 | fix(gateway): record a transcript notice when a run fails before replying | 응답 전에 실패한 실행을 트랜스크립트 공지로 기록(응답 유실 가시화) | 9 files changed, 529 insertions(+), 44 deletions(-) | - |
| `4ff90358328` | #138917 | fix(update): preserve state artifacts when reading history | 업데이트 이력 조회 시 state 아티팩트 보존 | 2 files changed, 141 insertions(+), 4 deletions(-) | - |
| `999fce1926c` | #139689 | fix(sessions): prevent cleanup failures during other database writes | 다른 DB 쓰기 중 세션 정리 실패 방지 | 7 files changed, 160 insertions(+), 105 deletions(-) | - |
| `53b3ac08313` | #139660 | fix(update): finish npm upgrades from 2026.9.1 | 2026.9.1 에서 올라오는 npm 업그레이드 완주 | 7 files changed, 72 insertions(+), 57 deletions(-) | - |
| `1b9d69e6ea9` | #137713 | fix(config): preserve config when Doctor prefix recovery fails | Doctor prefix 복구 실패 시 기존 설정 보존 | 3 files changed, 93 insertions(+), 24 deletions(-) | - |
| `895b7e2391f` | #139709 | fix(update): stop stale beta plugins from looping gateway startup | 오래된 베타 플러그인이 게이트웨이 시작을 루프시키지 않게 함 | 30 files changed, 1646 insertions(+), 1281 deletions(-) | - |
| `4681f8d5fed` | #139698 | fix(memory): keep concurrent maintenance from stalling search | 동시 유지보수가 메모리 검색을 멈추지 않게 함 | 27 files changed, 969 insertions(+), 294 deletions(-) | - |
| `65261168902` | #139765 | fix(gateway): drain retryable assistant text before clearing its group | 재시도 가능한 어시스턴트 텍스트를 그룹 정리 전에 배출(응답 유실 방지) | 2 files changed, 9 insertions(+), 13 deletions(-) | - |
| `2a488546aab` | #139821 | fix(memory): keep cleanup from blocking concurrent searches | 정리 작업이 동시 검색을 막지 않게 함 | 12 files changed, 474 insertions(+), 270 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `9739f4516a7` | #139783 | fix(gateway): retire setup prompts before shutdown drains | 셧다운 배출 전에 설정 프롬프트를 회수 | 5 files changed, 649 insertions(+), 131 deletions(-) | - |
| `bf090f0f797` | #139777 | fix(memory): short queries miss note content with trigram indexing | trigram 색인에서 짧은 질의가 노트 본문을 놓치던 결함 수정 | 5 files changed, 206 insertions(+), 233 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `d1a69c0b209` | #138839 | fix(update): validate candidates before stopping the Gateway | 업데이트 후보를 검증한 뒤에야 게이트웨이를 정지(업데이트 안전화 핵심) | 134 files changed, 13633 insertions(+), 4145 deletions(-) | 포크 겹침 3건: config/assertion-safety-baseline.txt, src/cli/gateway-cli/run.ts, src/infra/update-run-report.ts |
| `29d30210a93` | #139793 | fix(gateway): stop input downloads after HTTP clients disconnect | HTTP 클라이언트 연결이 끊기면 입력 다운로드 중단 | 10 files changed, 319 insertions(+), 102 deletions(-) | 포크 겹침 2건: src/gateway/openai-http.ts, src/gateway/openresponses-http.ts |
| `b6ca24cb092` | #139465 | fix: keep rate-limit retries transient and prevent split chat replies | rate limit 재시도를 일시적으로 유지하고 채팅 응답이 쪼개지는 문제 해결 | 74 files changed, 2471 insertions(+), 909 deletions(-) | 포크 겹침 3건: apps/shared/OpenClawKit/Sources/OpenClawProtocol/GatewayModels.swift, config/assertion-safety-baseline.txt, ui/src/i18n/locales/en.ts |
| `87ceec92ecd` | #139722 | fix(update): refuse incompatible agent stores before changing the installation | 호환되지 않는 에이전트 저장소면 설치 변경 전에 거부 | 31 files changed, 3446 insertions(+), 733 deletions(-) | - |
| `7969f4992a8` | #139879 | fix(memory): preserve exact-file ranking in active project searches | 활성 프로젝트 검색에서 정확 파일명 랭킹 보존 | 5 files changed, 119 insertions(+), 40 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `3d0254af02b` | #139700 | fix(sqlite): prevent writes after failed nested rollback | 중첩 롤백 실패 후 쓰기를 막아 DB 손상 방지 | 6 files changed, 310 insertions(+), 15 deletions(-) | - |
| `835c4e2fd6c` | #139947 | fix(cron): keep forced disabled one-shots disabled | 강제 비활성화된 일회성 cron 이 다시 켜지지 않게 함 | 3 files changed, 80 insertions(+), 9 deletions(-) | - |
| `53600f309e6` | #139949 | fix(config): preserve authored settings across includes | include 경계를 넘나드는 저장에서 사용자 작성 설정 보존 | 2 files changed, 373 insertions(+), 97 deletions(-) | - |
| `ba29914fc24` | #139967 | fix(cron): deliver fresh output when manually running overdue jobs | 기한 지난 작업을 수동 실행할 때 최신 출력 전달 | 3 files changed, 164 insertions(+), 10 deletions(-) | - |
| `0a753eb92f6` | #140083 | fix(cron): preserve pending paced checks across restart | 재시작 후에도 보류 중인 페이스 체크 보존 | 3 files changed, 192 insertions(+), 3 deletions(-) | - |
| `13b19222ded` | #140104 | fix(memory): preserve lexical recall in project sessions | 프로젝트 세션에서 어휘 기반 recall 보존 | 3 files changed, 109 insertions(+), 6 deletions(-) | - |
| `36d48279ec4` | #138391 | fix(memory): restore indexing after embedding row-cap errors | 임베딩 행 상한 오류 후 색인 재개 | 3 files changed, 60 insertions(+), 10 deletions(-) | - |
| `57d38f981db` | #138322 | fix(cron): retire removed sessions through the gateway lifecycle | 삭제된 세션을 게이트웨이 수명주기로 정리 | 9 files changed, 538 insertions(+), 25 deletions(-) | - |
| `98c0918709f` | #136639 | fix(sessions): archive aged conversations and raise the active cap | 오래된 대화를 ID·트랜스크립트 세대 유지한 채 보관, 활성 세션 상한 5,000 으로 상향 | 48 files changed, 1139 insertions(+), 390 deletions(-) | 포크 겹침 5건: docs/.generated/config-baseline.sha256, docs/gateway/config-agents.md, packages/gateway-protocol/src/schema/sessions-row.ts |
| `9ae24dfffee` | #140568 | fix(gateway): preserve child turns during systemd drain | systemd drain 중 자식 턴 보존 | 10 files changed, 65 insertions(+), 30 deletions(-) | - |
| `05182b6ad8a` | #116108 | fix(config): save config changes into the nested $include file that owns them | 설정 변경을 그 값을 소유한 중첩 $include 파일에 저장 | 33 files changed, 2391 insertions(+), 277 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `44dbc50d172` | #139196 | fix: allow authorized credential flows without blanket refusals | 소유자 인가된 자격증명 흐름을 무조건 거부하지 않도록 수정 | 14 files changed, 146 insertions(+), 252 deletions(-) | 포크 겹침 1건: src/agents/tool-description-presets.ts |
| `e58b5bde581` | #141006 | fix(sqlite): prevent cleanup timeouts during periodic vacuum | 주기적 vacuum 중 정리 타임아웃 방지 | 4 files changed, 85 insertions(+), 5 deletions(-) | - |
| `857ae4447f3` | #140984 | fix(memory): honor profile and home paths in host lookups | 호스트 조회에서 프로필·홈 경로를 존중 | 8 files changed, 357 insertions(+), 217 deletions(-) | - |
| `8e957553cf8` | #141297 | fix(gateway): retain owned run loop through failed restarts | 재시작 실패 후에도 소유 run loop 유지 | 4 files changed, 196 insertions(+) | - |
| `c2affa16cb1` | #141296 | fix(config): apply environment changes after in-process restart | 인프로세스 재시작 후 변경된 환경변수를 실제 적용 | 3 files changed, 146 insertions(+), 5 deletions(-) | - |
| `e11016dbd56` | #141090 | fix(agents): keep tool history stable after Gateway restarts | 게이트웨이 재시작 후 도구 이력이 흐트러지지 않게 함 | 19 files changed, 519 insertions(+), 42 deletions(-) | - |
| `aa603427017` | #141444 | fix(agents): stop replaying obsolete deferred tool replies | 철회된 지연 도구 응답의 재생 중단(중복 응답 방지) | 10 files changed, 422 insertions(+), 22 deletions(-) | - |
| `b0ae5b6793e` | #138984 | fix(sessions): publish complete rewrites without reset amplification | 트랜스크립트 재작성을 원자적으로 발행(중단 시 부분 이력 노출 방지) | 17 files changed, 1373 insertions(+), 171 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `bdf5d9939ab` | #141416 | fix(gateway): stop restart loops for required maintenance | 필수 유지보수가 막을 때 재시작 루프 중단 | 27 files changed, 394 insertions(+), 414 deletions(-) | 포크 겹침 3건: config/assertion-safety-baseline.txt, src/cli/gateway-cli/run.ts, src/flows/doctor-health.ts |
| `79dcb093e50` | #141507 | fix(sessions): retain SQLite write failure details in logs | SQLite 쓰기 실패 상세를 로그에 유지 | 3 files changed, 99 insertions(+), 3 deletions(-) | - |
| `dbdca2b6a47` | #141434 | fix(sessions): keep edits responsive during cleanup validation | 정리 검증 중에도 세션 편집 응답성 유지 | 11 files changed, 1222 insertions(+), 316 deletions(-) | - |
| `399caa03a17` | #141104 | fix(memory): use fallback search when SQLite extensions are unavailable | SQLite 확장을 못 쓰는 환경에서 폴백 검색 사용(납품 컨테이너에 중요) | 4 files changed, 24 insertions(+), 9 deletions(-) | - |
| `1580e46654f` | #138666 | fix(control-ui): measure context usage against the effective token budget | 컨텍스트 사용량을 실효 토큰 예산 기준으로 측정 | 22 files changed, 438 insertions(+), 25 deletions(-) | 포크 겹침 2건: src/gateway/session-utils.test.ts, ui/src/i18n/locales/en.ts |
| `7f9bf1d79ae` | #141562 | fix(update): recover stale runs without stopping healthy gateways | 정상 동작 중인 게이트웨이를 멈추지 않고 방치된 업데이트 기록 회수 | 54 files changed, 3306 insertions(+), 294 deletions(-) | 포크 겹침 2건: config/knip.config.ts, src/cli/update-cli/status.ts |
| `07636e80c71` | #140579 | fix(config): preserve authored settings through updates and setup | 업데이트·설치 과정 전반에서 사용자 작성 설정 보존 | 132 files changed, 3236 insertions(+), 991 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `d12106ef815` | #141718 | fix(agents): preserve queued replies across session handoffs | 세션 핸드오프 사이에 큐잉된 응답 보존 | 5 files changed, 165 insertions(+), 14 deletions(-) | - |
| `a620ab69246` | #141731 | fix(agents): preserve shared history and deletion retries | 에이전트 삭제 시 공유 이력 보존과 정리 재시도 | 49 files changed, 2677 insertions(+), 1332 deletions(-) | 포크 겹침 1건: src/gateway/server-methods/agents.ts |
| `6627766f5bf` | #141879 | fix(memory): recover searches after manager replacement | 메모리 매니저 교체 후 검색 복구 | 3 files changed, 63 insertions(+), 14 deletions(-) | - |
| `a6a4e88da29` | #141918 | fix(sqlite): scale the integrity child budget with database size | DB 크기에 맞춰 무결성 검사 자식 예산 조정(대형 DB 타임아웃 방지) | 5 files changed, 109 insertions(+), 8 deletions(-) | - |
| `d8885d9b0be` | #141480 | fix(subagents): completion can fail when requester key is unscoped | requester key 스코프가 없을 때 서브에이전트 완료가 실패하던 결함 수정 | 3 files changed, 475 insertions(+) | - |
| `37dbd0aac65` | #142169 | fix(gateway): return fresh config revisions after agent mutations | 에이전트 변경 후 최신 설정 리비전 반환 | 4 files changed, 60 insertions(+), 8 deletions(-) | - |
| `abad3479e6a` | #137675 | fix(sqlite): preserve Unicode in worker stderr tails | 워커 stderr 꼬리의 유니코드 보존(한글 로그 깨짐) | 2 files changed, 36 insertions(+), 1 deletion(-) | - |
| `dbe985b4e31` | #142286 | fix(gateway): retain shared state until cleanup finishes | 정리가 끝날 때까지 공유 state 유지 | 7 files changed, 355 insertions(+), 133 deletions(-) | - |
| `63ff23f8659` | #142290 | fix(gateway): prevent read-only password connection failures | 읽기 전용 공유 state 사용 시 비밀번호 전용 연결 실패 방지 | 2 files changed, 122 insertions(+), 7 deletions(-) | - |
| `c2d29e7678a` | #142187 | fix(gateway): serialize session timing clears in events | 이벤트의 세션 타이밍 초기화를 직렬화 | 6 files changed, 158 insertions(+), 56 deletions(-) | - |
| `c9342d6cc4f` | #142135 | fix(gateway): retain timeout notices after chat reload | 채팅 리로드 후에도 타임아웃 공지 유지 | 24 files changed, 884 insertions(+), 208 deletions(-) | 포크 겹침 1건: src/gateway/server-runtime-subscriptions.ts |
| `996c928205d` | #137877 | fix(auto-reply): show usage for invalid approval decisions | 잘못된 승인 결정 입력에 사용법을 보여주고 특이 ID 를 수용 | 3 files changed, 131 insertions(+), 4 deletions(-) | - |
| `22ccb29b27c` | #142482 | fix(sessions): preserve daily reset hour across DST transitions | DST 전환을 넘어 일일 리셋 시각 보존 | 2 files changed, 98 insertions(+), 8 deletions(-) | - |
| `684760b6d4b` | #142498 | fix(gateway): keep secret recovery notices accurate for cold owners | 콜드 소유자 상태에서 시크릿 복구 안내를 정확히 표시 | 3 files changed, 57 insertions(+), 45 deletions(-) | - |
| `e60b536bd08` | #142505 | fix(sessions): skip cleanup for newly protected history | 새로 보호된 이력은 정리 대상에서 제외 | 3 files changed, 263 insertions(+), 14 deletions(-) | - |
| `42db9213624` | #135865 | fix(gateway): preserve concurrent agent workspace file edits | 동시 에이전트 워크스페이스 파일 편집 보존(덮어쓰기 손실 방지) | 18 files changed, 833 insertions(+), 74 deletions(-) | 포크 겹침 5건: apps/shared/OpenClawKit/Sources/OpenClawProtocol/GatewayModels.swift, packages/gateway-protocol/src/schema/agents-models-skills.ts, src/gateway/server-methods/agents.ts |
| `edd440bd391` | #142581 | fix(control-ui): reload chat assistant identity on config change | 설정 변경 시 채팅 어시스턴트 신원 재로드 | 4 files changed, 205 insertions(+), 12 deletions(-) | - |
| `270b4adc030` | #143039 | fix(sqlite): preserve fatal WAL diagnostics from worker threads | 워커 스레드의 치명적 WAL 진단 보존 | 2 files changed, 47 insertions(+), 9 deletions(-) | - |
| `56145576b23` | #142168 | fix(agents): recover final replies after terminated streams | 스트림이 끊긴 뒤에도 최종 응답 복구 | 7 files changed, 92 insertions(+), 6 deletions(-) | - |
| `b0dbfa39610` | #142817 | fix(gateway): preserve restored-version verification across update restart | 업데이트 재시작을 넘어 복원된 버전 검증 유지 | 2 files changed, 206 insertions(+), 3 deletions(-) | - |
| `4a2824644c9` | #140914 | fix(gateway): prevent systemd restarts from hanging | systemd 재시작이 매달리는 문제 해결 | 2 files changed, 92 insertions(+), 94 deletions(-) | - |
| `4693a96225a` | #143307 | fix(system-agent): retain approval classifier resources through cleanup | 승인 분류기 리소스를 정리 완료까지 유지 | 3 files changed, 440 insertions(+), 68 deletions(-) | - |
| `678cd08c190` | #143238 | fix(agents): drop the blanket credential prompt that blocked owner-authorized logins | 소유자 인가 로그인을 막던 포괄적 자격증명 프롬프트 제거 | 27 files changed, 296 insertions(+), 338 deletions(-) | 포크 겹침 3건: src/agents/system-prompt.ts, src/agents/tool-description-presets.ts, src/plugins/compat/registry-records.ts |
| `057e3570344` | #143285 | fix(sessions): prevent excess cleanup after disk pressure clears | 디스크 압박 해소 후 과도한 정리 방지 | 3 files changed, 158 insertions(+), 49 deletions(-) | - |
| `0762f596752` | #143354 | fix: support autoreview through managed secret egress | 관리형 시크릿 egress 경유 autoreview 지원(WebSocket 추론 복구) | 9 files changed, 2080 insertions(+), 874 deletions(-) | - |
| `84fd689763c` | #133693 | fix(cron): prevent isolated runs from failing during runtime refresh | 런타임 갱신 중 격리 실행이 실패하던 결함 수정 | 5 files changed, 405 insertions(+), 56 deletions(-) | - |
| `289880b7246` | #143310 | fix(auth): scope the legacy auth-profile migration refusal to affected providers | 레거시 auth 프로필 마이그레이션 거부를 해당 provider 로 한정 | 36 files changed, 2095 insertions(+), 395 deletions(-) | - |
| `6812dd0f93e` | #142741 | fix(cron): prevent Gateway hangs on stalled reservations | 멈춘 예약 자원 점유로 게이트웨이가 매달리는 문제 해결 | 7 files changed, 555 insertions(+), 48 deletions(-) | - |
| `4cfeeeceac0` | #143193 | fix(memory): keep flush within the session context budget | 메모리 flush 를 세션 컨텍스트 예산 안으로 제한 | 6 files changed, 115 insertions(+), 14 deletions(-) | - |
| `5d891e46673` | #143574 | fix(state): retain original database errors after rollback cleanup | 롤백 정리 후에도 원래 DB 오류 보존 | 4 files changed, 100 insertions(+), 5 deletions(-) | - |
| `e75ebdebdfc` | #143599 | fix(doctor): recover legacy node tokens with invalid scopes | 스코프가 깨진 레거시 노드 토큰을 Doctor 로 복구 | 10 files changed, 305 insertions(+), 20 deletions(-) | - |
| `0a202622ded` | #140833 | fix(gateway): preserve paragraph boundaries in streamed replies | 스트리밍 응답의 문단 경계 보존 | 12 files changed, 266 insertions(+), 56 deletions(-) | - |
| `d9d12d46259` | #143531 | fix(sqlite): name the repair path in schema drift failures | 스키마 드리프트 실패 시 복구 경로를 명시 | 2 files changed, 18 insertions(+), 1 deletion(-) | - |
| `1c0d32c78f2` | #143726 | fix(sessions): keep old metadata from breaking reset history | 오래된 메타데이터가 리셋 이력을 깨뜨리지 않게 함 | 4 files changed, 115 insertions(+), 11 deletions(-) | - |
| `0cd2aedb110` | #143908 | fix(state): tolerate transient locks during read-only access | 읽기 전용 접근 중 일시적 잠금을 허용 | 2 files changed, 67 insertions(+), 1 deletion(-) | - |
| `878bc51433d` | #143832 | fix(cron): release canceled background result waits | 취소된 백그라운드 결과 대기 해제 | 3 files changed, 113 insertions(+), 1 deletion(-) | - |
| `6ce11d6a4c8` | #143960 | fix(gateway): avoid duplicate user turns after Claude CLI resume | Claude CLI 재개 후 사용자 턴이 중복 기록되는 문제 해결 | 5 files changed, 610 insertions(+), 78 deletions(-) | - |

## C. 성능 (36건)

| sha | PR | 제목(원문) | 설명 | 파일수/규모 | 비고 |
|---|---|---|---|---|---|
| `5de7576a5ab` | #139115 | perf(agents): reuse compaction estimates within each split decision | 분할 판정마다 compaction 추정치를 재사용 | 1 file changed, 21 insertions(+), 36 deletions(-) | - |
| `31903060a5d` | #139157 | perf(agents): bound retained tool result projection data | 보존되는 도구 결과 투영 데이터량 제한 | 11 files changed, 157 insertions(+), 80 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `d1df83eb30a` | #139146 | fix(sessions): reduce cold catalog listing delays | 콜드 상태 세션 카탈로그 목록 지연 감소 | 7 files changed, 335 insertions(+), 31 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `672adca9aa6` | #139300 | perf(sessions): reduce allocations when navigating transcripts | 트랜스크립트 탐색 시 할당 감소 | 2 files changed, 6 insertions(+), 6 deletions(-) | - |
| `15ec133bff6` | #139301 | perf(agents): speed up large branch-summary preparation | 대형 브랜치 요약 준비 속도 개선 | 1 file changed, 3 insertions(+), 3 deletions(-) | - |
| `6ef2f6f3435` | #139324 | perf(agents): reduce compaction cut-selection allocations | compaction 컷 선택 할당 감소 | 1 file changed, 17 insertions(+), 40 deletions(-) | - |
| `5ef2d24143d` | #139325 | perf(replies): bound pending tool-delivery observers | 대기 중 도구 전달 옵저버 수 제한 | 1 file changed, 43 insertions(+), 41 deletions(-) | - |
| `06f5cce42df` | #139327 | perf(sessions): avoid discarded waits in queued store writes | 큐잉된 store 쓰기에서 버려지는 대기 제거 | 1 file changed, 1 insertion(+), 5 deletions(-) | - |
| `6a1160acffb` | #139350 | perf(memory): reuse typed chunk publication statements | 메모리 청크 발행 statement 재사용 | 14 files changed, 368 insertions(+), 204 deletions(-) | - |
| `071f606eae7` | #139911 | fix(gateway): reduce cold model-runtime request stalls | 콜드 모델 런타임 요청 지연 감소(425파일 대형 리팩터, 충돌 위험 큼) | 425 files changed, 11316 insertions(+), 8519 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `7683bc3cf46` | #136293 | perf: bound code-point prefix allocations | 코드포인트 프리픽스 할당 제한 | 17 files changed, 90 insertions(+), 15 deletions(-) | 포크 겹침 1건: ui/vite.config.ts |
| `9f4de8e27d2` | #140414 | fix(gateway): reduce repeated model work when listing sessions | 세션 목록 조회 시 반복 모델 작업 제거 | 3 files changed, 98 insertions(+), 13 deletions(-) | - |
| `940c359a362` | #140566 | fix(anthropic): preserve resumed CLI caches across Git changes | Git 변경을 넘어 재개된 CLI 프롬프트 캐시 보존 | 7 files changed, 57 insertions(+), 30 deletions(-) | - |
| `4cf8d68eec0` | #140449 | improve: retain current worker builds between sessions | 세션 간 현재 워커 빌드 재사용 | 12 files changed, 375 insertions(+), 119 deletions(-) | - |
| `acba0c658dc` | #140669 | perf(memory): avoid cloning an owned flush snapshot | 소유한 flush 스냅샷 복제 제거 | 3 files changed, 139 insertions(+), 12 deletions(-) | - |
| `d448f2bbb55` | #140698 | fix(agents): keep tool schema ordering deterministic for prompt caching | 프롬프트 캐시를 위해 도구 스키마 순서를 결정적으로 유지 | 5 files changed, 109 insertions(+), 3 deletions(-) | - |
| `c27999bcfc3` | #140713 | fix(agents): avoid pruning warm caches during tool loops | 도구 루프 중 워밍된 캐시가 잘려나가지 않게 함 | 7 files changed, 200 insertions(+), 16 deletions(-) | - |
| `de0b6849e19` | #140651 | fix(agents): keep image history stable during tool loops | 도구 루프 중 이미지 이력 안정화 | 4 files changed, 66 insertions(+), 21 deletions(-) | - |
| `ccf15af73cd` | #140744 | fix(agents): preserve hook instructions in Gemini cached requests | Gemini 캐시 요청에 훅 지시문 보존 | 5 files changed, 105 insertions(+), 8 deletions(-) | - |
| `331d6b7f686` | #140797 | fix(bedrock): keep prompt cache checkpoints on conversation history | Bedrock 프롬프트 캐시 체크포인트를 대화 이력에 고정 | 16 files changed, 532 insertions(+), 119 deletions(-) | - |
| `5a4f24e73e9` | #140804 | fix(anthropic): preserve tool cache when system prompts change | 시스템 프롬프트가 바뀌어도 Anthropic 도구 캐시 보존 | 8 files changed, 312 insertions(+), 181 deletions(-) | - |
| `110a636dd16` | #140849 | fix(agents): preserve Responses cache prefixes across user turns | 사용자 턴을 넘어 Responses 캐시 프리픽스 보존 | 9 files changed, 256 insertions(+), 19 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `f0cc57d6b46` | #140799 | fix(agents): preserve cached history when background work changes | 백그라운드 작업 변화에도 캐시된 이력 보존 | 35 files changed, 1075 insertions(+), 566 deletions(-) | 포크 겹침 1건: src/agents/system-prompt.ts |
| `1e9d55c58fb` | #140840 | fix(sessions): shorten stalls during cold session updates | 콜드 세션 업데이트 지연 단축 | 12 files changed, 1733 insertions(+), 118 deletions(-) | 포크 겹침 1건: config/assertion-safety-baseline.txt |
| `b5d66d8ef1c` | #141077 | fix(agents): preserve prompt caches when Windows exec approvals change | Windows exec 승인 변화에도 프롬프트 캐시 보존 | 13 files changed, 213 insertions(+), 69 deletions(-) | - |
| `7f06602a11d` | #141073 | fix(agents): preserve Gemini cache across runtime context changes | 런타임 컨텍스트 변화에도 Gemini 캐시 보존 | 9 files changed, 278 insertions(+), 47 deletions(-) | - |
| `dcc733dc20e` | #141141 | improve(workers): reduce cloud runtime preparation overhead | 클라우드 런타임 준비 오버헤드 감소 | 5 files changed, 234 insertions(+), 121 deletions(-) | - |
| `7e93b57678f` | #141359 | perf(gateway): bound scalar session authorization reads | 스칼라 세션 인가 읽기 횟수 제한 | 3 files changed, 54 insertions(+), 3 deletions(-) | 포크 겹침 2건: src/gateway/session-sharing.ts, src/gateway/session-sharing-policy.ts |
| `439a4310ef3` | #140730 | fix(memory): avoid repeated vector search startup delays | 벡터 검색 시작 지연 반복 제거 | 10 files changed, 40 insertions(+), 4 deletions(-) | - |
| `00bd9750be3` | #142612 | fix(gateway): reduce repeated cold presence reads | 콜드 presence 읽기 반복 제거 | 4 files changed, 309 insertions(+), 27 deletions(-) | - |
| `efa6acb1aea` | #143226 | fix(sessions): move cold cleanup integrity checks off the main thread | 콜드 정리 무결성 검사를 메인 스레드 밖으로 이동 | 6 files changed, 1021 insertions(+), 186 deletions(-) | 포크 겹침 1건: test/scripts/lint-suppressions.test.ts |
| `561d3199fd5` | #143332 | fix(sessions): keep cold history planning off the main thread | 콜드 이력 계획을 메인 스레드 밖으로 이동 | 5 files changed, 385 insertions(+), 68 deletions(-) | - |
| `8ba562ec516` | #143379 | fix(sessions): keep archive pruning validation off the main thread | 아카이브 정리 검증을 메인 스레드 밖으로 이동 | 3 files changed, 421 insertions(+), 48 deletions(-) | - |
| `8f6cdd32d63` | #143453 | perf: avoid repeated system-message trimming | 시스템 메시지 트리밍 반복 제거 | 1 file changed, 3 insertions(+), 10 deletions(-) | - |
| `f2ccf21b432` | #143605 | fix(gateway): keep update history reads responsive | 업데이트 이력 조회 응답성 유지 | 7 files changed, 345 insertions(+), 52 deletions(-) | - |
| `3ebf5f06d63` | #143602 | fix(sessions): keep maintenance responsive after handle eviction | 핸들 축출 후 유지보수 응답성 유지 | 3 files changed, 246 insertions(+), 22 deletions(-) | - |

## D. 제외 중 판단이 애매했던 것

| sha | PR | 제목(원문) | 제외 사유 |
|---|---|---|---|
| `4f8f762ff51` | #141987 | feat(exec): let the auto-reviewer allow, deny, or escalate commands | 9.4 `Security and Privacy` 의 Improvements 항목이라 A 규칙상 포함 대상처럼 보이지만, 명령 자동 검토에 거부 판정을 새로 넣는 기능 추가이고 플러그인 SDK 계약도 바뀐다(52파일). 결함 수정이 아니라 D 로 뒀다. 도입하려면 #142279, #143308 과 함께 검토해야 한다 |
| `d6a9a63c775` | #142279 | feat(exec): give the auto-reviewer bounded conversation context | 위 기능의 후속. 대화 본문을 검토 모델에 넘기는 동작이라 납품처 감사 정책(본문 미기록)과도 맞물린다 |
| `ce0e84d0732` | #140672 | fix(runtime): require Node builds with lossless SQLite reads | 요청서에서 Breaking 으로 명시 제외했지만, 내용은 Node 내장 SQLite 의 텍스트 절단으로 대화 본문이 잘리는 데이터 손상을 막는 것이다. 포크는 이미 Node 24.15 이상을 요구하므로 실제 필요한 하한만 24.16 으로 올리는 별도 판단이 필요하다 |
| `48307ec958b` | #139489 | feat: share selected sessions publicly in a read-only view | 신규 기능이라 제외했다. 다만 A 의 #143873(초안 전환 시 아티팩트 읽기 차단)이 이 기능의 접근 제어 수정이므로, 기능을 안 가져오면 #143873 도 적용 대상이 없을 수 있다. 확인 후 #143873 을 빼도 된다 |
| `e982e7cd1ee` | #139250 | feat(ui): add social preview links for private sessions | 비공개 세션 링크 미리보기. 프라이버시 취지지만 기능 추가이고 `src/gateway/control-ui.ts`, `src/gateway/server-http.ts` 등 포크 수정 파일과 5건 겹친다 |
| `479455b0494` | #141514 | improve(control-ui): one Gateway secret field instead of token or password | 로그인 화면의 시크릿 입력을 한 칸으로 합치는 변경. 포크는 이 화면을 IX-Auth 로그인으로 대체했으므로 충돌만 크고 이득이 없다. 짝인 #141511(온보딩), #141456(연결 필드 양쪽 수용)도 같은 이유로 제외 |
| `b4a0a358c25` | #139623 | fix(apple): harden native state file permissions | 파일 권한 강화라 보안이지만 macOS 네이티브 앱 전용이라 납품 스택에 해당 없음 |
| `11c2a46c18f` | #141518 | fix(android): keep a stale operator hello from overwriting the handoff-issued device token | 기기 토큰 덮어쓰기라 보안에 가깝지만 Android 앱 부트스트랩 전용 |
| `20738254ecf` | #142907 | fix(linux): preserve remote credential references on reconnect | 9.4 에서 `Security and Privacy` 절 밖에 있는 유일한 "Security and trust" 항목인데, 대상이 리눅스 네이티브 데스크톱 앱이라 게이트웨이와 무관 |
| `d88e1749f76` | #140875 | fix(skills): secure the duplicate-triage setup | 커밋 제목의 secure 때문에 보안 grep 에 걸렸지만 실제 내용은 Skill Workshop 중복 정리 테스트 설정이다. Workshop 자체가 9.3 신규 기능이라 제외 |

채널 플러그인 전용 수정은 D 규칙상 제외 대상이지만, 보안 항목은 A 우선 규칙에 따라 A 에 넣었다. 해당 커밋은 `#136508`(Slack), `#143484`(Feishu/Lark), `#142041`(Tlon), `#142589`(WhatsApp) 네 건이고, 납품 스택은 이 채널을 쓰지 않으므로 실사용 기준으로는 건너뛰어도 된다.

## 부록. 체리픽 순서 (오래된 것 먼저)

`git cherry-pick` 에 그대로 넣을 수 있게 커밋 순서대로 정렬했다. 앞의 한 글자는 카테고리다.

```
B 5a17ad0e0e2
A d7a1753b9f5
B 140eb569a0b
B 91095dcd9bf
B bf7ccd6f191
B bcf699c2b9b
B a9f5e448323
B 834c7c0487e
C 5de7576a5ab
B 2c75b75f0d8
A 12a3b102f50
C 31903060a5d
C d1df83eb30a
A e731a1b7f4f
B 707edba619a
B d0137988844
B 426ca0d50f3
C 672adca9aa6
C 15ec133bff6
C 6ef2f6f3435
A a3cb57962cf
B df804fc6ff4
C 5ef2d24143d
A 1c7a73f3199
C 06f5cce42df
B 43590115324
C 6a1160acffb
A baacbbeaf60
B feda3963485
B 31fddf425fe
A 9f225f5333e
B 64a7abd6dfd
B 53802447f8c
B 26178af8147
B 425c6945a69
B 4f1bfcae70a
B 2a77ac90956
A d6eba6c0ca1
B 4ff90358328
B 999fce1926c
B 53b3ac08313
B 1b9d69e6ea9
A 51be20280b5
B 895b7e2391f
B 4681f8d5fed
B 65261168902
B 2a488546aab
B 9739f4516a7
B bf090f0f797
B d1a69c0b209
B 29d30210a93
B b6ca24cb092
A 4a9a0914b72
B 87ceec92ecd
B 7969f4992a8
B 3d0254af02b
B 835c4e2fd6c
B 53600f309e6
B ba29914fc24
A 811eb132a18
B 0a753eb92f6
B 13b19222ded
B 36d48279ec4
C 071f606eae7
B 57d38f981db
C 7683bc3cf46
C 9f4de8e27d2
B 98c0918709f
B 9ae24dfffee
C 940c359a362
A 7ff0e11c1f9
C 4cf8d68eec0
C acba0c658dc
C d448f2bbb55
A 0bca64f26ab
C c27999bcfc3
C de0b6849e19
B 05182b6ad8a
C ccf15af73cd
C 331d6b7f686
C 5a4f24e73e9
B 44dbc50d172
C 110a636dd16
C f0cc57d6b46
C 1e9d55c58fb
A 2d0d99fe08d
B e58b5bde581
B 857ae4447f3
C b5d66d8ef1c
C 7f06602a11d
A 0c9330b4c34
A 094afc92581
A 841694048e1
C dcc733dc20e
A 91c864ca19b
B 8e957553cf8
B c2affa16cb1
B e11016dbd56
A cf65773dcc0
C 7e93b57678f
A 7cab04806c9
C 439a4310ef3
B aa603427017
A 2994c201996
B b0ae5b6793e
A e57e375a402
B bdf5d9939ab
A 7ac87c0a461
B 79dcb093e50
B dbdca2b6a47
B 399caa03a17
B 1580e46654f
B 7f9bf1d79ae
B 07636e80c71
A 59f57f3cc5f
B d12106ef815
A b3589c4248a
B a620ab69246
B 6627766f5bf
A 9a5ba678d99
B a6a4e88da29
B d8885d9b0be
A aefcc525bac
A 8d0d9e9a08d
A f9ea6dbb69c
B 37dbd0aac65
B abad3479e6a
B dbe985b4e31
A 8d79c6ab2c3
B 63ff23f8659
B c2d29e7678a
A b824b72ce28
A c11ea06355b
A 7069a4772ff
B c9342d6cc4f
B 996c928205d
B 22ccb29b27c
B 684760b6d4b
B e60b536bd08
A 97e1985d0e4
C 00bd9750be3
A 2d1dfeab758
A 959854ce735
B 42db9213624
B edd440bd391
A 64ef483a100
B 270b4adc030
B 56145576b23
A 9bf06f7cc0f
A 3bd8ec2b39b
C efa6acb1aea
B b0dbfa39610
B 4a2824644c9
B 4693a96225a
B 678cd08c190
B 057e3570344
A cc81bfade70
C 561d3199fd5
B 0762f596752
B 84fd689763c
C 8ba562ec516
B 289880b7246
C 8f6cdd32d63
B 6812dd0f93e
B 4cfeeeceac0
B 5d891e46673
B e75ebdebdfc
C f2ccf21b432
C 3ebf5f06d63
B 0a202622ded
B d9d12d46259
A 1a6d46b02ab
B 1c0d32c78f2
A 088b3471ada
A 0669f6b2c5b
A 0670cd25c26
B 0cd2aedb110
B 878bc51433d
A fdf711c862c
A f78e6ed29f9
B 6ce11d6a4c8
```

## 적용 기록 배치 A (보안)

2026-09-16 실행. 부록 순서(오래된 것 먼저)로 `git cherry-pick -x` 했다. 푸시하지 않았다.

| PR | sha(업스트림) | 결과 | 새 커밋 | 충돌 파일·해결 요지 |
|---|---|---|---|---|
| #139056 | `d7a1753b9f5` | 건너뜀 | - | v2026.9.2 태그에 이미 같은 내용이 들어 있어 체리픽 결과가 빈 커밋이 된다. proxy-env.ts 내용이 HEAD 와 동일함을 확인 |
| #136623 | `12a3b102f50` | 적용 | `c93212c20c0` | - |
| #139142 | `e731a1b7f4f` | 적용 | `cb7675812c5` | - |
| #139332 | `a3cb57962cf` | 적용 | `619d44f2da2` | - |
| #139337 | `1c7a73f3199` | 적용 | `1e7f044803d` | - |
| #139387 | `baacbbeaf60` | 적용 | `3dc2ba20055` | - |
| #139368 | `9f225f5333e` | 적용 | `b422add26c6` | - |
| #139536 | `d6eba6c0ca1` | 적용 | `daaf3993511` | docs/.generated/config-baseline.sha256: 생성물이라 포크(HEAD) 유지 |
| #139421 | `51be20280b5` | 적용 | `29e71daf2ec` | - |
| #139844 | `4a9a0914b72` | 적용 | `da896d1d1d2` | src/gateway/auth.ts import 충돌: IX-Auth 3줄 + 업스트림 isInvalidGatewayToken 둘 다 보존 |
| #127216 | `811eb132a18` | 적용 | `d80f17f2621` | - |
| #129144 | `7ff0e11c1f9` | 적용 | `1185274c9e1` | 64파일 중 61파일 자동 병합. realtime-quicksilver-session-lifecycle.test.ts import 는 HEAD 유지(findSourceImportBackedges 미사용), 포크에 없는 docs/web/control-ui/chat.md 와 realtime-quicksilver-session-retirement.test.ts 는 삭제 유지 |
| #140381 | `0bca64f26ab` | 적용 | `f65e180ceb3` | - |
| #140859 | `2d0d99fe08d` | 적용 | `6480d4bc006` | 75파일 중 70파일 자동 병합. attempt-prompt-build.ts 는 fragments 기반 런타임 컨텍스트 구조만 받고 포크에 없는 runtime-facts-prompt.ts 의존부는 제외, session-accessor.entry-mutation.ts 는 HEAD 유지, 런타임 팩트 의존 테스트 케이스 제거 |
| #140903 | `0c9330b4c34` | 적용 | `f886ffd946f` | service.event-loop.test.ts: 업스트림 수용(operator.read 스코프 모킹) |
| #133843 | `094afc92581` | 적용 | `5797b0b36fd` | - |
| #140873 | `841694048e1` | 적용 | `0a8daa25537` | - |
| #141247 | `91c864ca19b` | 적용 | `6fa0af203b8` | runs.ts·session-active-runs.ts·server-session-events.test.ts 업스트림 수용, reply-turn-admission.ts 는 들여쓰기만 다른 충돌이라 HEAD 유지 후 agentId 전달 2곳만 수동 반영. test-support 에 session-progress 목 추가. 포크에 없는 sessions-read-active.test.ts 는 삭제 유지 |
| #139604 | `cf65773dcc0` | 적용 | `82d3d674ff5` | - |
| #141086 | `7cab04806c9` | 보류 | `8af8d6ab249 (5d92d17127d 로 되돌림)` | @openclaw/fs-safe 0.8.4+ 의 inspectTarArchive 전제. 포크는 0.8.1 핀이라 타입검사 실패. 의존성 상향 판단 필요 |
| #141421 | `2994c201996` | 적용 | `10da9d56188` | agent-bundle-mcp-materialize.ts 는 HEAD 구조 유지 후 projectMcpGetPromptResult(untrustedMcpOutput) 만 수동 반영, types.ts 는 업스트림 수용 |
| #141471 | `e57e375a402` | 적용 | `2540d98e09a` | execute-plugin.ts: resolveExecToolConfig 만 수용, 포크에 없는 recordAgentCleanupFailure 제외. 후속 커밋에서 test-support 없는 native-bash 테스트 제거 |
| #141484 | `7ac87c0a461` | 적용 | `61f0d1e10ae` | - |
| #141544 | `59f57f3cc5f` | 적용 | `4f86d68aa79` | dispatch-from-config.prepare-execution.ts import 합집합 |
| #141720 | `b3589c4248a` | 적용 | `3def647f73d` | src/gateway/auth.ts: IX-Auth import 보존 + isInvalidGatewaySecret 로 개명 반영 |
| #141960 | `9a5ba678d99` | 보류 | `5f961b30213 (ce067941819 로 되돌림)` | quickjs-wasi 3.6.0 의 MAX_STACK_SIZE·maxStackSize 전제. 포크는 3.5.0 핀 |
| #142130 | `aefcc525bac` | 적용 | `eee135a05a3` | cleanup-utils.ts·agents.ts 업스트림 수용, moveToTrash 계열에 assertCurrent 선택 인자 추가. agents.ts 의 assertCurrent() 호출은 포크에 해당 가드가 없어 후속 커밋에서 제거 |
| #142074 | `8d0d9e9a08d` | 적용 | `fe705e480ca` | - |
| #142158 | `f9ea6dbb69c` | 적용 | `175f95a2229` | provider-attribution.ts 는 포크의 기존 스냅샷 모듈 경로 유지 + matchesPluginProviderEndpoint 추가, manifest-planner.ts 는 includeProvider 게이트 수용 후 포크의 remoteModelIds·manifestModelsById 복원. docs 는 새 규칙 문장만 추가 |
| #137684 | `8d79c6ab2c3` | 적용 | `9b31518ccaa` | - |
| #141477 | `b824b72ce28` | 보류 | - | 103파일 중 15파일 충돌(auth-profiles 전반). 포크에 없는 OAuth 리스 리팩터링에 의존해 수동 포팅이 하루 이상. abort 후 보류 |
| #136508 | `c11ea06355b` | 적용 | `83884d82063` | - |
| #137668 | `7069a4772ff` | 적용 | `5ece74dfa48` | - |
| #142557 | `97e1985d0e4` | 적용 | `0554d21a68a` | prepared-model-catalog.test.ts 는 HEAD 의 stale 케이스와 업스트림 readOnly=undefined 케이스 합집합 |
| #142589 | `2d1dfeab758` | 적용 | `e9f07c0636d` | - |
| #142041 | `959854ce735` | 적용 | `536a1b60059` | - |
| #142873 | `64ef483a100` | 적용 | `51c1fd5d04b` | - |
| #142093 | `9bf06f7cc0f` | 적용 | `d7df6f46b91` | - |
| #142661 | `3bd8ec2b39b` | 적용 | `c7b2976d4ff` | - |
| #143308 | `cc81bfade70` | 적용 | `1aecc558b16` | exec-auto-reviewer.test.ts import 에서 포크에 없는 ExecAutoReviewTranscript 제외. docs 는 타임아웃 예산 문단만 추가. 후속 커밋에서 acquireSimpleCompletionModelForAgent 래퍼를 포크에 추가 |
| #143724 | `1a6d46b02ab` | 적용 | `730f1f6a353` | mcp-http.ts: 포크의 McpLoopbackServer 타입 유지 + MAX_MCP_BODY_BYTES 추가 |
| #143799 | `088b3471ada` | 적용 | `2cd61994f19` | - |
| #143873 | `0669f6b2c5b` | 적용 | `d715afb405d` | 전제 기능(#139489)이 없어도 충돌 없이 적용됨 |
| #143899 | `0670cd25c26` | 적용 | `c186d156ad2` | backup-create.ts 는 privacy violation 우선 판정만 수용하고 포크에 없는 configCapture.assertRootAlias 블록 제외. 후속 커밋에서 src/infra/file-descriptor.ts 이식 |
| #143521 | `fdf711c862c` | 적용 | `549f2f0aa63` | 포크에 없는 docs/plugins/sdk-channel-plugins/status-and-media.md 는 삭제 유지 |
| #143484 | `f78e6ed29f9` | 적용 | `b6071a58cb3` | 포크에 없는 docs/channels/feishu/*.md 는 삭제 유지 |

집계: 적용 42 / 수동 포팅 0 / 건너뜀 1 / 보류 3 (합계 46).

후속 커밋 2건:

- `5d92d17127d` 보안 체리픽 후속: #141086 되돌림(fs-safe 0.8.5 inspectTarArchive 의존)
- `ce067941819` 보안 체리픽 후속: 타입 오류 수정

### 검증

- `node scripts/check-no-conflict-markers.mjs` 통과, `git diff HEAD --check` 통과.
- `corepack pnpm exec tsgo --noEmit -p tsconfig.json` 실행. 체리픽 전(`73df173c93b`) 기준선과 오류 집합이 동일하다(신규 오류 0). 기준선 자체에 스크립트 `.mjs` 타입 선언 부재 등 기존 오류가 남아 있고 그 목록은 변하지 않았다.
- vitest·`pnpm check`·`pnpm build` 는 지침대로 실행하지 않았다(윈도우에서 Chrome 창이 뜬다).

### 700줄 상한을 새로 넘긴 파일

- `src/agents/embedded-agent-runner/run/attempt-llm-boundary.ts` 648 -> 722
- `src/gateway/talk-realtime-relay-session-create.ts` 685 -> 706

(이미 700줄을 넘고 있던 파일은 제외했다. CI 가 최종 판정한다.)

### 남은 위험 (직접 확인하지 못한 것)

- 테스트를 한 번도 돌리지 않았다. 특히 #140859·#141247·#143308 처럼 업스트림 테스트를 포크 구조에 맞춰 손본 파일은 CI 에서 처음 검증된다.
- #140859 는 런타임 컨텍스트 조립을 fragments 기반으로 바꾸면서 포크에 없는 runtime-facts-prompt 경로를 뺐다. 실행 세션에서 런타임 컨텍스트가 의도대로 분리되는지는 운영 실측이 필요하다.
- #142130 은 agents.delete 의 TOCTOU 재검증(assertCurrent) 없이 Trash 루트 정책만 반영했다. 포크에는 해당 가드 자체가 없다.
- #141086·#141960 은 의존성 버전이 올라가야 적용 가능하다(@openclaw/fs-safe 0.8.4+, quickjs-wasi 3.6.0). 각각 TAR 아카이브 신원 인가와 QuickJS 게스트 재귀 제한이 빠진 상태다.
- #141477(공유 OAuth 리프레시 펜싱)은 통째로 보류다. 동시 토큰 갱신 경합은 그대로 남아 있다.
- #141471 의 native Bash 허용목록 회귀 테스트, #129144·#141247 의 신규 테스트 파일은 포크에 지원 모듈이 없어 넣지 못했다.
- 채널 플러그인 보안 수정(#136508 Slack, #143484 Feishu, #142041 Tlon, #142589 WhatsApp)은 적용했지만 납품 스택이 이 채널을 쓰지 않아 실동작 확인이 없다.
