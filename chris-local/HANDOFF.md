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
- **라이브 상태(이 PC)**: compose 스택 4컨테이너 기동 중, 게이트웨이 이미지는 K 코드 기준(`fdc3b837012`). WSL 로컬 게이트웨이도 같은 커밋으로 자동 배포됐다. 모델은 **Claude 단독**이다(Y 단계). 템플릿의 기본 모델은 `anthropic/claude-sonnet-5`, 허용 목록은 Claude 3종이고 codex 플러그인은 꺼져 있다. 인증은 인증 저장소의 Claude setup-token 프로필 `anthropic:manual` 하나다. `chris-local/ixauth.env` 에 `OPENCLAW_NAS_ROOT=./nas-sample`, `OPENCLAW_KNOWLEDGE_ROOT=./knowledge-index` 가 켜져 있고 rnd 색인 폴더에 사이드카 8개가 생성돼 있다. 관리자 권한 수정은 **재로그인 후** 반영된다(`user_profiles.role` 은 로그인 때 투영).
- **N 단계(채팅 첨부 소유권·부서 경계·재참조)**: 첨부는 미디어 id 하나로만 서빙돼서 로그인만 돼 있으면 누구나 남의 첨부를 받을 수 있었다(`assistant-media` 의 `sessionKey` 가 선택 파라미터, 인바운드 참조는 폴더 컨테인먼트를 항상 통과). 공용 DB 에 feature-local `inbound_media` 를 두어 세션·에이전트·프로필·원본명을 기록하고, `src/gateway/inbound-media-access.ts` 단일 판정이 참조 문자열 자체로 부서·소유자·세션 가시성을 검사한다(거부는 404 + 원장 `access_denied`). 올린 파일을 나중에 다시 꺼내는 도구 `media_list`·`media_read` 를 넣었고(`readonly` 프로필 포함, 문서는 색인과 같은 변환기로 텍스트 추출) 세션을 지워도 파일은 남기고 삭제 표시만 찍는다. 납품 템플릿에 `attachments.ttlHours` 는 넣지 않는다. 정본은 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 7-1 과 [FILE-PREVIEW.md](FILE-PREVIEW.md) 8절. **이 표가 생기기 전에 올라온 첨부(레거시)는 소유자가 없어 시스템 관리자만 열 수 있다** - 기존 대화의 이미지가 일반 사용자에게 404 로 보이면 그 이유다.
- **M 단계(CI/CD·NAS 배치)**: `chris/main` 푸시마다 GitHub Actions(`.github/workflows/chris-deliver-images.yml`)가 게이트웨이·ix-auth 이미지를 굽고 `ghcr.io/necromman/openclaw-gateway`·`openclaw-ix-auth` 에 민다(태그 `chris-main` + `sha-<짧은 커밋>`, 둘 다 public). 진바이오 NAS `/volume1/docker/openclaw/` 에 납품 스택을 세웠고, root cron 이 5분마다 `deploy.sh` 를 돌려 태그가 움직였을 때만 pull 하고 다시 띄운다. 절차·되돌리기·실측은 [DEPLOY.md](DEPLOY.md) 13절. 머지 커밋 `0bf73af4e12`. 자동 반영은 실물로 확인했다: 푸시 19:07 -> Actions 성공 19:18 -> cron 이 19:20:02 에 잡아 19:28:29 배포 완료.
- **O 단계(2026-09-08 밤, `chris/main` 직접)**: 납품 구성이 확정됐다. **에이전트는 `main` 하나**이고 부서 에이전트 `rnd-bot`·`qa-bot` 은 템플릿에서 뺐다(부서·사용자·테스트 계정은 유지, NAS 의 `department_agents` 바인딩도 정리). **모델은 기본 `openai/gpt-5.6-luna`, 예비 `anthropic/claude-sonnet-5`** 이고 채팅 모델 선택 목록은 `agents.defaults.modelPolicy.allow` 로 그 둘만 보인다. 세션 사이드바의 "새 세션 - Claude Code"·"새 세션 - Codex" 카탈로그는 `plugins.entries.{codex,anthropic}.config.sessionCatalog.enabled=false` 로 껐다(런타임은 살아 있어 구독 로그인이 계속 동작한다). 선재 결함 2건도 고쳤다: 내부 메일 웹훅 403(서비스 키로 인증하는 서버 간 경로를 프록시 귀속 요구에서 제외 + cloudflared 고정 주소 `172.16.240.10` 으로 신뢰 프록시 축소)과 관리자 사용자 화면 차단(역할 기반 판정으로 교체). 되켜는 절차는 [DEPLOY.md](DEPLOY.md) 3.3-1, 상세는 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 5절 O 행.
- **Q 단계(2026-09-08 밤, `chris/main` 직접)**: 사용자 지시 4건을 반영했다. 커밋 `b5760968c05`·`d98c98df2e8`·`64dc42c1f2b`, 이미지 빌드 34244196167 성공, NAS 배포 2026-09-09 00:41:24 KST, 운영 실측 4항목 통과(증적 chris-server `analysis/2026-09-07-openclaw-auth/delivery-q-01..04-*.png`). 상세는 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 5절 Q 행.
  - **에이전트 이름은 "공용"** 이다(설명 "회사 공용 AI 비서"). 첫 대화에서 비서가 이름을 되묻던 것은 워크스페이스 `BOOTSTRAP.md` 온보딩 시드였다. 이제 `start-gateway.sh` 가 기동마다 `/config/workspace-seed/` 의 `IDENTITY.md`·`SOUL.md` 를 워크스페이스(`workspace` 와 `workspace-main` 둘 다)에 렌더하고 `BOOTSTRAP.md` 를 지운다. 정체성 파일이 템플릿과 다르면 게이트웨이가 그 워크스페이스를 "설정 끝남" 으로 기록하므로 다시 시드되지 않는다. 비서의 이름·언어·역할을 바꾸려면 그 두 파일을 고치고 NAS 사본에도 복사한다.
  - **세션 가시성은 "본인만"** 이다. `tools.sessions.visibility=self` 이고 **직원·중재자의 `sessions.others` 는 `none`** 이다. 사람이 보는 세션 목록은 가시성 값이 아니라 역할 상한이 정하기 때문에 둘 다 바꿔야 했다. 시스템 관리자·관리자는 전체를 보고 임원은 읽기만 한다. 부서 게이트는 이 값에 매달려 있어 함께 꺼졌다(에이전트가 미바인딩 `main` 하나라 실질 손실은 없다). 부서 에이전트를 켜는 날 `department` 로 되돌려야 한다. 근거는 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 0·3-1절.
  - **"홈" 은 사람마다 다른 대화다.** ix-auth 모드에서 게이트웨이가 접속자에게 알려 주는 main 키에 프로필 해시를 붙인다(`src/gateway/home-session-key.ts`, 호출 2곳). URL 은 그대로 `/chat/main` 이고 같은 주소가 사람마다 자기 대화를 연다. 옛 공용 홈 `agent:main:main` 은 지워지지 않고 남으며 관리자·임원만 볼 수 있다.
  - **함정: 템플릿 설정이 조용히 무시된다.** 게이트웨이는 마지막으로 받아들인 설정에 최상위 `meta` 가 있었는데 새 설정에 없으면 손상으로 보고 백업을 복원한다(`Config auto-restored from backup ... (missing-meta-vs-last-good)`). 게이트웨이가 마이그레이션을 한 번 기록하면 `meta` 를 스스로 쓰므로 그 뒤 모든 템플릿 렌더가 버려진다. 템플릿에 `meta.migrations.modelPolicyAllowlist` 를 넣어 고쳤다. **설정을 고쳤는데 안 바뀌면 기동 로그의 이 줄을 먼저 본다.**
  - **함정: NAS 는 `/config` 를 이미지가 아니라 호스트 폴더로 마운트한다**(`./ixauth-gateway-config:/config:ro`). 저장소 템플릿을 고치고 푸시해도 반영되지 않는다. `/volume1/docker/openclaw/ixauth-gateway-config/` 의 사본에도 같은 파일을 복사해야 한다(백업 `*.bak-q-20260908`).

- **R 단계(2026-09-09, `chris/main` 직접)**: NAS 폴더 접근권한 0~1단계. 커밋 `657a5e6bb33`(compose) -> `679f70a65e2`(서버) -> `d78ab7765ca`(화면). 설계 정본 [NAS-FOLDER-ACL.md](NAS-FOLDER-ACL.md), 구현 결과는 그 문서 12절, 설치 절차는 [DEPLOY.md](DEPLOY.md) 11.4-1.
  - **NAS 에 전용 그룹 두 개를 새로 만들었다.** `openclaw-ro`(gid 65540)·`openclaw-rw`(gid 65541), 구성원 없음. 공유 9개 ACL 에 **추가만** 했고 기존 그룹·사용자 항목은 손대지 않았다. 되돌리기는 `synoacltool -del <경로> <인덱스>` 와 `synogroup --del`, 원본 ACL 사본은 NAS 의 `/volume1/docker/openclaw/nas-acl-backup/`.
  - **컨테이너에 `group_add: 65540` 을 주고 공유 9개를 `/mnt/nas/<공유 이름>` 으로 `:ro` 마운트했다.** `OPENCLAW_NAS_SHARES_ROOT=/volume1`·`OPENCLAW_NAS_GROUP_GID=65540` 이 NAS 의 `ixauth.env` 에 있다. compose 백업은 `docker-compose.nas.yml.bak-20260909-acl`.
  - **`보안폴더` 7개는 상속이 끊겨 있어 컨테이너에서도 계속 막힌다.** 앱 규칙과 무관하다. NAS ACL 이 앱 권한의 상한이라는 것이 이 배치의 성질이다.
  - **규칙이 없는 폴더는 아무에게도 보이지 않는다.** 화면(`/settings/folders`, 관리자 이상)에서 규칙을 만들어야 열린다. 판정은 깊은 경로 우선, 같은 경로에서는 개인 > 부서 > 역할, 같은 종류가 여럿이면 더 강한 제한이 이긴다.
  - **함정: 관리자는 `operator.admin` 스코프를 받지 않는다.** 그 스코프는 시스템 관리자의 것이라, 관리자가 쓸 RPC 를 그 스코프로 걸면 화면 전체가 `missing scope` 로 막힌다. 폴더 메서드 다섯을 `operator.read` 로 내리고 등급 판정은 핸들러에서 한다(`6b03c6a7d64`). 새 관리자용 메서드를 만들 때 같은 함정을 밟지 않는다.
  - **운영 실측 통과(2026-09-09)**: 관리자 트리 11개, 규칙 저장·상속·깊은 경로 우선, 미리보기에서 숨김 확인, 직원 메뉴 없음, 감사 원장 2건. 스크린샷은 chris-server `analysis/2026-09-07-openclaw-auth/delivery-r-0*.png` 6장.
  - **아직 아닌 것**: 세션 파일 목록·미리보기·지식 색인에는 규칙이 걸리지 않는다(2단계). 에이전트가 도구로 읽는 파일과 쓰기는 3단계다.

- **V 단계(2026-09-09, `chris/main` 직접)**: NAS 폴더 접근권한 **2단계**(적용 지점)와 한글 미리보기 표. 커밋 `da48894d22c` -> `d0ffdef53c1` -> `2dad03a3b16` -> `d0948323dff` -> `cfb183bb685` -> `092893d81fd`. 정본은 [NAS-FOLDER-ACL.md](NAS-FOLDER-ACL.md) 13절, 색인 규칙은 [KNOWLEDGE.md](KNOWLEDGE.md) 8-1, 미리보기는 [FILE-PREVIEW.md](FILE-PREVIEW.md) 9-6, 사용자 안내는 [MANUAL.md](MANUAL.md) 8-1.
  - **규칙이 파일을 읽는 경로에 걸린다.** 게이트 하나(`src/gateway/folder-access-guard.ts`)를 세션 파일 목록·열기·쓰기, 에이전트 파일, 워크스페이스 브라우저에 붙였다. 문서 미리보기는 파일 읽기를 지나므로 함께 닫힌다. 거부는 없는 파일과 **같은 문구**이고 원장에 `access_denied`/`folder-read` 로 남는다.
  - **함정: 게이트를 넓게 잡으면 제품이 닫힌다.** 규칙의 기본값이 숨김이라, 게이트가 에이전트 홈 워크스페이스까지 덮으면 아무 파일도 안 보인다. 게이트는 브라우징 루트가 `/mnt/nas` 안일 때만 만들어지고, 호스트 연결·시스템 관리자에게는 만들어지지 않는다. 새 표면을 붙일 때 이 조건을 같이 붙여야 한다.
  - **색인은 사람이 아니라 폴더로 판정한다.** 크론이 돌리고 사이드카는 공용 풀이라 사람별 필터가 없다. "누구 하나라도 볼 수 있는 폴더만 색인한다" 가 그 시점에 성립하는 유일한 문장이다. 걷기 자체를 자르므로 파일 이름도 안 읽고, 걷지 않은 폴더의 사이드카는 기존 고아 정리가 지운다(회수 장치를 따로 만들지 않았다).
  - **함정: 어떤 공유에 규칙을 처음 하나 쓰면 그 공유의 색인 범위가 규칙이 있는 곳으로 좁아진다.** 규칙이 한 번도 언급하지 않은 공유는 종전대로 전부 색인한다(그러지 않으면 손대지도 않은 색인이 통째로 비워진다). 처음 걸 때는 `--dry-run --verbose` 로 먼저 본다. 한 번만 끄려면 `--no-folder-rules`.
  - **고아 규칙 화면**을 `/settings/folders` 아래 절에 넣었다. 폴더가 없어진 규칙과 부서·계정이 없어진 규칙 둘 다 모은다. 자동 복구는 하지 않고 두 번 물어 지운다.
  - **한글 문서 미리보기가 표를 표로 그린다.** 두 리더 선택 규칙을 `document-hangul-read.ts` 한 곳으로 모았고, 마크다운을 HTML 로 그리는 최소 렌더러를 새로 넣었다(새 npm 의존성 0, 전부 이스케이프 후 이 파일만 태그를 만든다).
  - **함정: 납품 구성에는 게이트가 걸릴 표면이 아직 없다.** 에이전트가 `main` 하나이고 그 워크스페이스가 컨테이너 홈이라(O 단계) 파일 패널이 NAS 를 보지 않는다. 공유를 에이전트 워크스페이스로 물리는 날 그대로 작동한다. V 실측은 NAS 설정 템플릿에 임시 에이전트를 붙였다 지우는 방식으로 했다(백업 `openclaw.json.bak-v-20260909`).
  - **운영 실측 통과**: 파일 패널 18개 -> 15개, `기록물` 이 목록에서 사라짐, 직접 열기 `session file not found`, 원장 거부 1건, 색인 `folder-hidden` 폴더당 한 줄 + 사이드카 5개 회수, 고아 목록·정리, hwp 표 렌더. 스크린샷 chris-server `analysis/2026-09-07-openclaw-auth/delivery-v-0*.png`.
  - **선재 실패**: `chris-check` 의 `plugin boundaries`(만료된 deprecation 창)는 그대로다. R 단계부터 빨갛던 포크 테스트 1건(`folder-access-path` 의 `"/"`)은 V 에서 고쳤다.

- **W 단계(2026-09-09, `chris/main` 직접)**: 운영 장애 두 건 + 모델 화면 재설계. 커밋 `60b799e941c` -> `66ba487d36c` -> `ce6bc25e7d9` -> `d7b3c49efe0` -> `79c42bf6ca7` -> `44ee2f41b5e`. 상세는 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 5절 W 행, 함정은 [DEPLOY.md](DEPLOY.md) 3.4 (바)·11.7 (바), 사용법은 [MANUAL.md](MANUAL.md) 10절.
  - **기본 모델이 `anthropic/claude-sonnet-5` 로 바뀌었다(사용자 확정).** 질문마다 30초씩 늦던 원인은 OpenAI 구독 로그인의 갱신 실패였고, 그 로그인을 작업 PC 와 NAS 가 나눠 쓴 것이 원인이다. Anthropic 은 setup-token 장기 토큰이라 갱신 자체가 없다. `openai/gpt-5.6-luna` 는 목록에 남아 있지만 **지금 고르면 30초 뒤 실패한다.** 되살리려면 NAS 전용 OpenAI 로그인이나 `OPENAI_API_KEY` 가 필요하다(DEPLOY.md 3.4 (다)·(라)).
  - **`Falling back from WebSockets to HTTPS transport` 는 터널 문제가 아니었다.** 상태 볼륨의 Codex 런타임 바이너리가 찍는 줄이고 위 인증 장애와 한 몸이다. 기본 모델을 옮기면서 함께 사라졌다. Cloudflare 터널 설정은 손대지 않았다.
  - **모델 화면이 바뀌었다.** `/settings/model-catalog` 이 프로바이더별 카탈로그 전체를 그리고 모델마다 스위치 하나다. 저장값은 언제나 켜진 모델의 명시적 목록이고 `provider/*` 와일드카드는 더 쓰지 않는다. **함정: 옛 저장본의 와일드카드를 화면이 열자마자 펼치므로 아무것도 누르지 않아도 저장 버튼이 켜져 있다.** 안내 문구가 그 이유를 말한다.
  - **선재 결함 2건을 함께 고쳤다.** 모델 ref 패턴이 슬래시 하나만 받아 `huggingface/deepseek-ai/DeepSeek-R1` 같은 실제 카탈로그 이름을 거부했고(전체 켜기가 `invalid_body`), 허용 목록 상한 100 과 공용 본문 한도 4 KiB 로는 카탈로그 82개가 들어가지 않았다(상한 300, 이 라우트만 64 KiB).
  - **함정: 한국어 문안은 소스가 아니라 번역 메모리에서 온다.** `ui/src/i18n/locales/ko.ts` 는 빌드 타임 가상 모듈 한 줄이고, 실제 문안은 `ui/src/i18n/.i18n/ko.tm.jsonl` 의 항목을 **영어 원문 해시로 매칭**해 만든다. 영어 문안을 고치면 그 키의 한국어가 조용히 영어로 되돌아간다. 새 키·바뀐 키는 그 파일에 직접 넣어야 한다(해시는 `sha256(공백 정규화한 영어 원문)`).


- **X 단계(2026-09-09, `chris/main` 직접)**: 폴더 트리 인덱싱과 문서 색인 운영. 커밋 `adb2b4ea354` -> `e784cd9c0f4` -> `409f834b4b0` -> `43ab54c7cd3` -> `2e2a974c84b` -> `9801bc56100`. 정본은 [NAS-FOLDER-ACL.md](NAS-FOLDER-ACL.md) 14절과 [KNOWLEDGE.md](KNOWLEDGE.md) 7.2~7.3·8-2, 절차는 [DEPLOY.md](DEPLOY.md) 12절, 사용자 안내는 [MANUAL.md](MANUAL.md) 4-1·8-1.
  - **트리가 느렸던 이유는 폴더 수가 아니었다.** 목록 코드가 `readdir` 뒤 이름 하나마다 `realpath`+`stat` 를 불러, 파일 3,127개가 든 폴더 한 단계가 856ms 였다. `readdir(withFileTypes)` 로 바꾸니 5ms 다. 그 위에 폴더 구조 저장본(상태 DB `folder_tree_nodes`·`folder_tree_scans`)을 두어 화면이 NAS 를 아예 읽지 않게 했다. **저장본이 없는 가지는 종전대로 직접 읽는다** - 저장본은 화면을 빠르게 할 뿐 동작의 전제가 아니다.
  - **훑기는 `openclaw folders scan` 이고 RPC 를 쓰지 않는다.** 그래서 ix-auth 배포의 컨테이너 안에서 그대로 돈다(`cron add` 가 막히는 것과 대비된다). 실측 **19,136 폴더 17.5초**, 못 읽은 폴더 7개(= 각 공유의 보안폴더). 2절의 37,356 은 호스트 root 기준이고 컨테이너가 보는 것은 19,136 이다.
  - **공유별 권한이 정해졌다(사용자 확정).** **관리자 전용은 `01_이화정` 하나**이고 나머지 여덟 공유는 직원·중재자·임원 읽기다. **민감 공유에는 "관리자 읽기" 를 주지 않는다** - 읽기를 주는 순간 그 폴더가 색인 대상 자격을 얻고, 사이드카 풀에는 사람별 칸막이가 없어 인사·급여가 공용 비서의 검색으로 새어 나간다. 관리자는 폴더 화면 트리(숨김도 보인다)와 NAS 탐색기로 본다. 규칙 표 현황은 NAS-FOLDER-ACL.md 14.8.
  - **문서 색인이 실제로 돈다.** compose 의 색인 마운트를 부모째(`/mnt/knowledge`)로 바꾸고 호스트 폴더 소유자를 uid 1000 으로 고쳤다(아니면 첫 파일에서 Permission denied). 공용 비서에 `memory.search.extraPaths` 를 물렸고, `/etc/crontab` 에 03:20 한 줄로 `nightly-index.sh` 가 `folders scan` -> `knowledge sync` -> `memory index` 를 돌린다. **업무 시간을 피하는 이유**는 2코어 NAS 가 낮에는 회사 파일 서버라서다.
  - **함정: 사람이 쓰는 공유에서는 색인이 파일 하나에 통째로 죽는다.** 첫 색인이 두 번 멈췄다. 파워포인트 잠금 파일(`~$이름.pptx`)이 훑기와 stat 사이에 사라져 ENOENT 로 끝났고(711개), 암호 걸린 PDF 가 예외를 던져 또 끝났다(1,163개). 둘 다 그 파일 하나만 건너뛰도록 고쳤다(`vanished`·`encrypted`). **새 변환기나 새 훑기를 붙일 때 같은 함정을 밟지 않는다 - 파일 하나의 실패는 파일 하나의 실패여야 한다.**
  - **NAS 자체 색인(Universal Search)은 쓰지 않는다.** 켜져 있고 공유 8개를 본문까지 색인하지만, 본문 필드 중앙값이 0~59자이고 한글 문서는 8%만 본문이 있으며(우리 사이드카는 평균 16KB), 접근이 호스트 root CLI 아니면 2단계 인증이 걸린 DSM 계정뿐이고, 우리 폴더 규칙을 모른다. 조사 수치는 KNOWLEDGE.md 8-2. **다시 조사하지 않는다.**
  - **알아 둘 것: `01_이화정` 은 DSM 색인에는 본문까지 들어 있다.** 우리 앱은 그 공유를 읽지 않지만 NAS 계정으로 DSM 검색을 쓰는 사람에게는 보인다. 그 경계는 NAS 관리자의 몫이다.
  - **진행 중**: 첫 색인(`00_공용폴더` 6,298개)이 아직 돌고 있다. 확인은 `sudo $D exec openclaw-ixauth_gateway_1 sh -lc 'find /mnt/knowledge/00_공용폴더 -name "*.md" | wc -l'`. 나머지 7개 공유는 `nightly-index.sh` 의 `SHARES` 에 한 번에 하나씩 더한다(합계 28,211 파일, 밤 4~5회).
- **Y 단계(2026-09-09, `chris/main` 직접)**: **OpenAI 를 걷어내고 Claude 단독 구성으로 바꿨다**(사용자 지시: "GPT 는 키 없애고, Anthropic 토큰으로 Claude 를 사용할 수 있게. CLI 는 필요 없다"). 정본은 [DEPLOY.md](DEPLOY.md) 3.4 (사)·(아), 사용자 안내는 [MANUAL.md](MANUAL.md) 10절.
  - **지운 것**: 상태 볼륨의 `codex-cli/auth.json`, NAS 호스트의 `codex-auth.json`, compose 두 파일의 `CODEX_HOME`·`OPENAI_API_KEY` 전달, `ixauth.env`(NAS·예제 둘 다)의 `OPENAI_API_KEY` 슬롯, 템플릿과 관리자 저장본의 OpenAI 모델. 지운 파일 사본은 NAS `/volume1/docker/openclaw/openai-removed-y-20260909/` 에 있다. **인증 저장소에는 지울 OpenAI 프로필이 애초에 없었다**(W 단계 장애로 영구 저장된 적이 없다).
  - **모델은 Claude 3종**: `claude-sonnet-5`(기본)·`claude-opus-5`(상위)·`claude-haiku-4-5`(경량). 카탈로그의 Anthropic 7종을 setup-token 으로 하나씩 실제 호출해 정했다. `claude-fable-5-1` 은 400 `claude_code_version_too_old`, `claude-mythos-5` 는 404 라 켜면 고르는 즉시 실패한다. `opus-4-8`·`fable-5` 는 200 이지만 쓰임이 겹쳐 껐다.
  - **codex 플러그인을 껐다**(`plugins.entries.codex.enabled=false`). O 단계가 카탈로그만 끄고 런타임을 살려 둔 이유(구독 로그인)가 사라졌기 때문이다. **Claude 응답 경로는 이것과 무관하다**: `anthropic/claude-*` 는 내장 러너가 `POST https://api.anthropic.com/v1/messages` 로 직접 부르고, 하네스를 등록하는 플러그인은 저장소에 `codex`·`copilot` 둘뿐이다. `anthropic` 플러그인은 프로바이더를 주므로 **끄면 안 된다**(그 안의 `sessionCatalog` 만 꺼져 있다).
  - **OpenAI 를 감추는 코드는 넣지 않았다. 넣을 필요가 없었다.** codex 플러그인을 끄자 OpenAI 프로바이더가 관리자 모델 카탈로그에서도 통째로 사라졌다(실측: 프로바이더 8개 -> 7개, `models list --all` 의 `openai/` 0건). `openai` 플러그인 자체는 그대로 실려 있다(기동 로그의 플러그인 12개에 들어 있다). 확인한 것은 "codex 를 끄면 OpenAI 모델이 카탈로그에서 사라진다" 는 사실이고, 되켜면 돌아온다. 자격증명이 없는 채로 남은 다른 프로바이더(`claude-cli` 등)는 "인증 없음" 으로 표시되고 스위치가 잠긴 채 그대로 둔다 - 감추면 관리자가 무엇을 켤 수 있었는지를 볼 길이 없어진다.

  - **운영 실측 통과(2026-09-09 16:39:57 KST 배포 뒤)**: 관리자·직원 각각 새 세션에서 `anthropic/claude-sonnet-5` 2초, 직원이 선택기에서 Opus 5 로 바꾸니 `anthropic/claude-opus-5` 4초. 선택기는 양쪽 모두 Claude 3개뿐이고 새 세션 화면에 CLI 실행 항목이 없다. 재기동 뒤 기동 로그의 `admin overrides applied: ...` 로 기본 모델·허용 목록이 유지되는 것을 확인했고, 로그 393줄에 `-32603`·`Falling back from WebSockets`·`codex` 0건이다. 스크린샷 chris-server `analysis/2026-09-07-openclaw-auth/delivery-y-01..07-*.png`.
  - **남긴 것**: 상태 볼륨의 codex 런타임 npm 패키지(`/home/node/.openclaw/npm/projects/`)는 지우지 않았다. 플러그인이 꺼져 실행되지 않고, 지우면 되살릴 때 다시 받아야 한다.

- **작업 규칙이 바뀌었다(2026-09-08 사용자 확정)**: `chris/main` 에서 직접 커밋·푸시하고 브랜치를 만들지 않는다. WSL 의 `pnpm check`·vitest·`pnpm format` 왕복과 로컬 compose 실측을 하지 않고, GitHub Actions 이미지 빌드 성공과 `https://jinbio.botops.cloud` 실측으로 판정한다. 상세는 CLAUDE.md 4절·FORK.md 3절·이 문서 6절.
- **납품 라이브 좌표**: `https://jinbio.botops.cloud`(Cloudflare Tunnel, HTTP 200 실측). 호스트는 진바이오 NAS 192.168.2.1(apps01 OpenVPN 경유), compose 프로젝트 `openclaw-ixauth`, 컨테이너 4개(db·ix-auth·gateway·cloudflared), 네트워크 대역 `172.16.240.0/24`(cloudflared 는 `.10` 고정). 시스템 관리자는 `admin@deploy.local` 이고 시험 계정 6개가 함께 있다. 자격증명과 배포 좌표는 `infra/local/jinbio-deploy.md`(git 제외).

- **다음 세션 첫 할 일**:
  1. **NAS 스택의 남은 세팅.** 실제 공유 폴더 매핑은 R 단계(2026-09-09)에서 끝났다(공유 9개가 `/mnt/nas/<공유>` 로 읽기 전용 마운트, DEPLOY.md 11.4-1). 남은 것은 SMTP(DEPLOY.md 3.8) 하나다. NAS 의 `ixauth.env` 를 고치고 `deploy.sh --force` 로 다시 띄우면 된다.
  2. **사용자 결정은 2026-09-08 에 전부 끝났다.** 9건의 결정값과 반영 위치는 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 4절 표가 정본이다: IX-Auth 라이선스(자사 제품이라 제약 없음), 도메인·TLS(`jinbio.botops.cloud` + Cloudflare Tunnel, PoC 단계, DEPLOY.md 11.7), SMTP(배포 후, DEPLOY.md 3.8), 약관(고객 제공), 부서 에이전트 API 키(배포 후, DEPLOY.md 3.4 (라)), 감사 보존 90일·질문 본문 미기록(기존 기본값과 동일), 시드 계정(로컬 유지·납품 시 정리, DEPLOY.md 4.1 (다)), 제품명(임시 "Chris Agent" 유지), 시작 번들 예산(기준선 갱신). 배포 시점에 값만 넣으면 되는 것은 DEPLOY.md 4.2 체크리스트에 모아 두었다.
  3. 부서 에이전트를 다시 켤 때는 DEPLOY.md 3.3-1 의 다섯 단계를 따른다(공유 마운트 -> 템플릿의 에이전트 항목 -> API 키 -> 색인). 지금은 `main` 하나이고 API 키 없이 Claude setup-token 하나로 Claude 3종이 다 답한다(Y 단계). 부서 에이전트도 이 경로를 그대로 쓸 수 있다: 폴더 경계가 깨지던 것은 codex 하네스였고 Claude 는 내장 러너로 돈다.
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
4. **게이트: 푸시 → GitHub Actions 이미지 빌드 성공 → NAS cron 반영(`deploy.log` 의 OK 줄) → `https://jinbio.botops.cloud` 브라우저 실측.** WSL 의 `pnpm check`·vitest·`pnpm format` 왕복과 로컬 compose 실측은 하지 않는다. 저장소 규칙(700줄 상한·env 이름 래칫·번들 상한)은 CI 가 걸러 준다. `chris-check` 워크플로(`.github/workflows/chris-check.yml`)가 lint·테스트를 비차단으로 돌린다. 빨간 불이면 다음 커밋에서 고친다. 푸시가 곧 배포이고, 중간 상태가 운영에 반영돼도 된다는 것이 사용자 결정이다.
5. chris-server 쪽은 스크린샷·문서만 두고 autosync 가 커밋한다. 포크 커밋은 자유.

## 7. 이번 작업에서 배운 함정 (재발 방지)

- **같은 ChatGPT 구독 로그인을 작업 PC 와 서버가 나눠 쓰면 서버가 죽는다(2026-09-09 운영 장애).** 구독 OAuth 는 갱신할 때 refresh 토큰을 회전시키므로, `~/.codex/auth.json` 을 복사해 NAS 에 넣어 두고 PC 에서 계속 codex 를 쓰면 PC 가 갱신할 때마다 NAS 사본이 무효가 된다. 증상은 질문마다 30초 지연 + `auth refresh request failed: code=-32603` + 예비 모델로 폴백이고, 사용자 화면에는 `Falling back from WebSockets to HTTPS transport` 도 함께 반복된다(그 문장은 게이트웨이도 Cloudflare 도 아니고 상태 볼륨의 Codex 런타임 바이너리가 찍는다). 30초는 재시도가 아니라 취소되지 않는 토큰 fetch 타임아웃 하나이고(`extensions/openai/openai-chatgpt-oauth-token.runtime.ts` 의 `TOKEN_REQUEST_TIMEOUT_MS`), runtime-only 프로필의 갱신 실패는 `OAuthRefreshFailureError` 가 아니라 평범한 `Error` 로 던져져 실패 쿨다운(`markAuthProfileFailure`)이 걸리지 않아 **질문마다 같은 값을 다시 문다**. 서버에 옮긴 로그인은 서버 것으로 보고, PC 에서 다시 쓰려면 서버용 계정을 따로 만든다. 상세와 대처는 [DEPLOY.md](DEPLOY.md) 3.4 (바)·11.7 (바). **지금 이 배포에는 이 함정을 밟을 경로가 없다**(Y 단계에서 OpenAI 구독 로그인을 통째로 지웠다). 이 항목은 되살릴 때를 위한 기록으로 남긴다.
- **O 단계에서 배운 것.** compose 네트워크의 주소 대역(`ipam`)은 돌고 있는 네트워크에 반영되지 않는다. 바꿨으면 `down` 후 `up` 이 한 번 필요하고, NAS 의 cron 은 `up -d` 만 부르므로 그 한 번은 손으로 한다(볼륨은 남는다). 에이전트를 설정에서 지울 때는 부서 바인딩(`department_agents`)을 먼저 지운다. 바인딩 명령이 "설정에 없는 id" 를 거부하기 때문인데, O 단계에서 `--clear` 만은 받아 주도록 고쳤다. `src/gateway/server-http.ts` 는 이미 696줄이라 몇 줄만 더해도 700줄 상한에 걸린다.

- 단위 테스트 통과 후 라이브에서만 드러난 결함이 15건(비루프백 바인드 가드가 ix-auth 를 "인증 없음" 판정, 페어링 면제가 루프백에만, 타 부서 전사 HTTP 200 등). 라이브 게이트를 빼면 안 된다.
- WSL2 유휴 종료는 `.wslconfig vmIdleTimeout=-1` 만으론 부족. 작업 스케줄러 `OpenClawWSLKeepalive` 가 해법.
- OpenClaw 파일 모드 드리프트가 `git pull --ff-only` 를 막은 적 있음(240e0fb 로 수정).
- 빌드가 다시 쓰는 추적 파일(플러그인 매니페스트·벤더 번들)도 같은 방식으로 pull 을 막았다. `auto-deploy.sh` 가 pull 직전에 그것들만 되돌리고 로그에 이름을 남긴다(L 단계). 되돌리는 목록은 각 확장의 `package.json` 이 스스로 선언한다.
- 번들 상한(최대 청크 215KiB gz)이 SheetJS 류 클라이언트 라이브러리를 원천 차단. 서버 변환으로 우회.
- `openclaw models auth login` 은 TTY 필수 → `script -q -f -c` 로 pseudo-TTY. 이후 `openclaw doctor --fix` 로 codex 런타임 활성 + 재시작이 한 세트.
- Debian 12 LXC 에는 dbus 가 없어 `openclaw gateway install` 이 실패한다.
