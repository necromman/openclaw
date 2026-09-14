# AEO/GEO 전문 에이전트 (정본)

> 진바이오테크 납품 스택에 붙인 두 번째 에이전트 `aeo-geo` 의 설계·설치·검증 정본이다. 시간은 전부 KST.\
> 관련: [DEPLOY.md](DEPLOY.md) 3.3-1·3.4·13.4-1, [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 0·3-1·9절, [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 5절.

## 1. 목적

검색이 "링크 목록" 에서 "AI 가 요약해 주는 답변" 으로 옮겨 가면서, 회사 페이지가 **그 답변에 인용되는가**가 새 지표가 됐다. 이 에이전트는 그 하나만 한다.

- **AEO**(Answer Engine Optimization, 답변엔진 최적화): 검색 답변에 우리 내용이 실리게 만드는 일.
- **GEO**(Generative Engine Optimization, 생성엔진 최적화): 같은 목표를 생성형 엔진(ChatGPT·Gemini·Perplexity) 쪽에서 부르는 이름.

대상 엔진은 넷이다. 네이버 AI 브리핑·대화형 AI 탭, ChatGPT, Gemini/AI Overviews, Perplexity.

## 2. 대표 요청 배경 (2026-09-14)

대표가 "AEO/GEO 를 다루는 전문 비서를 하나 두고 싶다" 고 요청했다. 조건이 둘 있었다.

1. **대표만 쓴다.** 지금은 사내 전 직원에게 열지 않는다. 효용을 먼저 보고 나서 연다.
2. **건강기능식품 규제를 안다.** 문안을 만드는 순간 표시·광고 규정에 걸리는 표현이 나오므로, 그것을 걸러 내지 못하면 쓸 수 없다.

두 조건이 이 문서의 3절(설계)과 4절(노출 제한)을 그대로 결정했다.

## 3. 설계

| 항목 | 값 | 왜 |
| --- | --- | --- |
| 에이전트 id | `aeo-geo` | 부서 에이전트가 아니라 주제 에이전트다 |
| 표시 이름 | AEO/GEO 비서 | 채팅 화면과 세션 목록에 이렇게 보인다 |
| 워크스페이스 | `/home/node/.openclaw/workspace-aeo-geo` | 상태 볼륨의 별도 폴더. 마운트가 아니라 쓰기 가능한 자기 폴더다 |
| 기본 모델 | `anthropic/claude-opus-5` | 감사·문안 작성이 길고 판단이 많다 |
| 사고 수준 | `thinkingDefault: "medium"` | 체크리스트를 세는 일에 충분하고 응답이 지나치게 늦지 않는다 |
| 고를 수 있는 모델 | opus-5, sonnet-5 | 이 에이전트만의 `modelPolicy.allow`. 공용의 아홉 개와 다르다 |
| 도구 | 프로필 `coding` + `browser` | `web_search`·`web_fetch`·파일 읽기·쓰기는 프로필에 있고, `browser` 는 어느 프로필에도 없어 `alsoAllow` 로 더한다 |
| 권한 모드 | `workspace` | 자기 워크스페이스 안에서만 쓴다 |
| 세션 도구 | `sessions_list`·`sessions_history`·`sessions_search`·`sessions_send` 거부 | 4-1 (다) 참조 |
| 사내 문서 | `memory.search.extraPaths: ["/mnt/knowledge"]` | 공용과 같은 색인을 본다 |

정본 파일은 `chris-local/ixauth-gateway-config/openclaw.json` 이고, 최상위에 브라우저를 켰다.

```json
{ "browser": { "enabled": true, "headless": true, "noSandbox": true } }
```

납품 이미지에 Chromium 이 들어 있다(`.github/workflows/chris-deliver-images.yml`). 컨테이너에서는 `headless`·`noSandbox` 둘 다 필요하다.

**공용 `main` 에도 `workspace` 경로를 적어 두었다.** 에이전트가 하나일 때는 프로세스 기본 워크스페이스(`workspace`)를 쓰지만, 둘이 되면 해석이 에이전트별 형식(`workspace-main`)으로 넘어갈 수 있다(`src/agents/agent-scope-config.ts` 의 `resolveAgentWorkspaceDir`). 그러면 공용 비서가 어느 날 빈 폴더에서 깨어난다. 경로를 적어 두는 것이 그 사고를 막는 유일한 방법이다.

### 3-1. 페르소나와 스킬

워크스페이스 시드는 `chris-local/ixauth-gateway-config/workspace-seed/aeo-geo/` 에 있고 기동마다 렌더된다(공용 워크스페이스와 같은 장치, DEPLOY.md 3.7-1).

| 파일 | 내용 |
| --- | --- |
| `IDENTITY.md` | 이름·역할·대상 엔진 표·하지 않는 일 |
| `SOUL.md` | 답변 원칙(근거 URL, 표와 우선순위, 규제 우선, 모르면 모른다), 도구 사용 원칙 |
| `AGENTS.md` | 감사 6단계 절차와 보고서 형식 |
| `skills/aeo-page-audit/SKILL.md` | 체크리스트 10항목, 0~100 점수 산식, 등급, 우선순위 |
| `skills/aeo-crawler-access/SKILL.md` | robots.txt 크롤러 아홉 종 판정, 권장 robots, 그 밖의 차단 원인 |
| `skills/aeo-schema-jsonld/SKILL.md` | Product·FAQPage·BreadcrumbList·Organization 템플릿과 필수 속성 |
| `skills/aeo-health-claims-guard/SKILL.md` | 건강기능식품 금칙 표현 사전 (가)~(아), 허용 문안 형식, 출력 형식 |

**스킬 허용목록(`agents.entries.aeo-geo.skills`)은 두지 않았다.** 범위는 워크스페이스가 잡는다. 워크스페이스 스킬은 `<workspace>/skills/<이름>/SKILL.md` 에서 읽히고(`src/skills/loading/workspace-skill-loader.ts`), 이 에이전트의 워크스페이스에는 위 넷만 있다. 기동 스크립트가 매번 `skills/` 를 지우고 다시 복사하므로, 템플릿에서 뺀 스킬은 다음 기동에 사라진다.

## 4. 노출 제한 원리

**부서 게이트를 켜고, 이 에이전트를 아무도 없는 부서에 묶는다.**

1. `tools.sessions.visibility` 를 `self` 에서 `department` 로 올린다. 이 값이 부서 게이트의 스위치다(`src/gateway/department-access.ts` 의 `isDepartmentScopeEnabled`: `gateway.auth.mode` 가 `ix-auth` 이고 이 값이 `department` 일 때만 경계가 선다).
2. IX-Auth 에 그룹 `dept-ceo` 를 만든다. **사람은 넣지 않는다.**
3. 컨테이너에서 `agents department --agent aeo-geo --set ceo` 로 묶는다.

그러면 판정이 이렇게 된다(`prepareDepartmentGate`).

| 사람 | `aeo-geo` | 공용 `main` |
| --- | --- | --- |
| 시스템 관리자(superadmin) | 보인다 (게이트 자체를 통과) | 보인다 |
| `dept-ceo` 구성원 | 보인다 | 보인다 |
| 그 밖의 사람(부서 있음) | **안 보인다**(`denied`) | 보인다 |
| 부서 없는 사람 | **안 보인다** | 자기가 만든 세션만 보인다 |

대표에게 열어 줄 때는 대표 계정을 `dept-ceo` 에 넣기만 하면 된다. 나중에 전사에 열려면 바인딩을 `--clear` 로 푼다. 묶이지 않은 에이전트는 경계 밖이라 부서가 있는 모두에게 열린다.

### 4-1. 부작용 넷과 대책

가시성을 `self` 에서 `department` 로 올리는 것은 이 에이전트 하나만의 문제가 아니다. **배포 전체의 판정이 바뀐다.** 네 가지를 확인하고 넘어갔다.

**(가) 부서가 없는 사람은 자기 세션만 보게 된다.** 위 표의 마지막 줄이다. `self` 였을 때도 어차피 자기 것만 봤으므로 일반 직원에게는 변화가 없다. 다만 **부서를 넣지 않은 관리자·임원**은 원래 남의 세션을 보던 것이 자기 것만 보이게 바뀐다. 대책: 관리·감독이 필요한 계정은 부서를 반드시 넣는다. 시스템 관리자는 영향이 없다.

**(나) 관리자 우회가 꺼진다.** 역할이 주는 `sessions.others: write`(관리자)·`view`(임원)는 부서 게이트 위에 있지 않다. 게이트를 그냥 통과하는 것은 시스템 관리자뿐이다. 대책: 전사 세션 조회가 필요하면 시스템 관리자 계정으로 한다. 부서 경계를 켜면 따라오는 정상 동작이며 결함이 아니다.

**(다) 모델이 쓰는 세션 도구의 범위가 넓어진다.** 이것이 가장 놓치기 쉽다. `visibility` 는 사람의 화면과 함께 **모델이 부르는 `sessions_*` 도구의 범위**도 정한다. `self` 에서는 현재 세션만 읽히지만 `department` 는 `self`·`tree` 제한 어디에도 걸리지 않아 **같은 에이전트의 다른 세션까지** 읽힌다(`src/plugin-sdk/session-visibility-internal.ts` 의 판정). 대책: `main`·`aeo-geo` 두 에이전트 모두에 `tools.deny` 로 `sessions_list`·`sessions_history`·`sessions_search`·`sessions_send` 를 막았다. 사람의 화면은 그대로고 모델만 못 읽는다.

**(라) 첨부 경계.** 첨부 접근 판정(`src/gateway/inbound-media-access.ts`, N 단계)도 세션 가시성을 읽는다. `department` 로 올라가면 같은 부서 안에서는 서로의 첨부가 열릴 수 있다. 지금은 `dept-ceo` 에 사람이 없고 다른 부서 사람들은 종전과 같은 범위이므로 실질 변화가 없다. **한 부서에 사람을 여럿 넣는 날 다시 본다.**

## 5. 웹 검색의 현재 상태

**Claude 경로에는 서버측 `web_search` 가 없다.** 이 납품은 Claude 단독이고(DEPLOY.md 3.4), Anthropic 러너는 검색을 대신 돌려주지 않는다. `tools.web.search.provider` 도 **일부러 설정하지 않았다.** 미설정이면 OpenAI 를 연결하는 날 네이티브 검색이 자동으로 켜지기 때문이다(`extensions/openai/native-web-search.ts`). 값을 하나 박아 두면 그 자동 전환이 막힌다. `tools.web.fetch` 도 기본값 그대로다.

그래서 지금 이 에이전트의 관찰 경로는 둘이다.

1. `web_fetch` 로 URL 원문을 받는다. robots.txt·sitemap.xml·HTML·JSON-LD 는 전부 이것으로 충분하다.
2. **검색 결과 화면은 `browser` 로 직접 연다.** naver.com·google.com 검색 화면을 열어 AI 브리핑에 우리 페이지가 인용되는지 눈으로 본다. 실제 노출을 보는 데는 오히려 이쪽이 정확하다.

`SOUL.md` 에 "`web_search` 가 응답하지 않으면 그 사실을 밝히고 브라우저 관찰로 대체한다" 를 명시해 두었다. 도구가 없다고 조사를 멈추지 않게 하는 장치다.

## 6. OpenAI 를 연결하는 날 할 일

`openai/gpt-5.6-sol` 은 **지금 넣으면 안 된다.** OpenAI 자격증명이 없어 선택 즉시 실패한다. 연결한 다음 순서로 한다.

1. DEPLOY.md 3.4 대로 OpenAI 자격증명을 게이트웨이 컨테이너에 준다.
2. `agents.entries["aeo-geo"].modelPolicy.allow` 에 `openai/gpt-5.6-sol` 을 더한다.
3. 채팅에서 그 모델로 한 번 실제 답을 받아 본다(DEPLOY.md 3.4 의 "모델을 새로 켤 때는 반드시 채팅에서 한 번 답을 받아 본다" 규칙).
4. `thinkingDefault: "medium"` 은 모델을 바꿔도 그대로 적용되므로 손대지 않는다.
5. 네이티브 `web_search` 는 `tools.web.search.provider` 가 비어 있으므로 자동으로 켜진다. 켜진 뒤에는 브라우저 관찰이 보조 수단이 된다.

**주의**: 모델 관련 네 키(`model`·`modelPolicy`·`utilityModel`·`imageModel`)는 이미 있는 에이전트에 한해 **관리자 화면이 템플릿을 이긴다**(DEPLOY.md 3.4 표, `merge-admin-overrides.mjs`). 템플릿을 고쳤는데 안 바뀌면 상태 볼륨의 `admin-overrides.json` 을 본다.

## 7. 배포 절차

NAS 는 `/config` 를 **호스트 폴더로** 마운트한다. 저장소에 푸시하는 것만으로는 반영되지 않는다.

```bash
# 1) 템플릿 폴더를 통째로 옮긴다. workspace-seed/aeo-geo/ 가 빠지면 set -eu 때문에
#    게이트웨이가 아예 뜨지 않는다 (DEPLOY.md 13.4-1).
#    NAS sshd 에 sftp 서브시스템이 없으므로 tar 를 표준입력으로 넣는다.
tar -C chris-local -cf - ixauth-gateway-config | ssh NAS주소 'cd /volume1/docker/openclaw && cp -a ixauth-gateway-config ixauth-gateway-config.bak-aeo && tar -xf -'

# 2) 반영
sudo /volume1/docker/openclaw/deploy.sh --force

# 3) 부서 그룹을 만든다 (IX-Auth 콘솔 /admin/identity/, 코드 dept-ceo, 구성원 없음)

# 4) 에이전트를 그 부서에 묶는다. --set 에는 접두사를 뗀 slug 를 넣는다.
sudo docker exec -u node 게이트웨이컨테이너 node openclaw.mjs agents department --agent aeo-geo --set ceo

# 5) 확인
sudo docker exec -u node 게이트웨이컨테이너 node openclaw.mjs agents department --json
```

되돌리기는 `agents department --agent aeo-geo --clear` 와 `ixauth-gateway-config.bak-aeo` 복원이다. 부서 게이트만 되돌리려면 템플릿의 `tools.sessions.visibility` 를 `self` 로 내리고 재기동한다.

## 8. 검증 항목

배포 후 이 순서로 확인한다.

| 번호 | 확인할 것 | 통과 기준 |
| --- | --- | --- |
| 1 | 기동 로그 | `Config auto-restored from backup ... (missing-meta-vs-last-good)` 이 **없다** |
| 2 | 워크스페이스 시드 | 컨테이너의 `/home/node/.openclaw/workspace-aeo-geo/` 에 `IDENTITY.md`·`SOUL.md`·`AGENTS.md` 와 `skills/` 아래 스킬 4개가 있다 |
| 3 | 공용 워크스페이스 | 공용 비서가 여전히 `/home/node/.openclaw/workspace` 를 쓴다(`workspace-main` 으로 옮겨 가지 않았다) |
| 4 | 에이전트 목록 | 시스템 관리자 계정에 `AEO/GEO 비서` 가 보인다 |
| 5 | 부서 경계 | 일반 직원 계정에는 보이지 않고, 세션 생성 시도는 `DEPARTMENT_ACCESS_DENIED` 로 막힌다 |
| 6 | 공용 영향 | 일반 직원이 공용 비서를 종전대로 쓴다 |
| 7 | 모델 | 채팅 모델 선택기에 opus-5·sonnet-5 둘만 보이고, 실제로 답이 온다 |
| 8 | 브라우저 | "naver.com 에서 성분명을 검색한 화면을 열어 봐" 에 실제로 화면을 읽고 답한다 |
| 9 | 스킬 | "이 URL 감사해 줘" 에 `AGENTS.md` 6단계 순서와 보고서 형식이 나온다 |
| 10 | 규제 게이트 | "간에 좋은 치료 효과 문구 써 줘" 에 금칙 판정과 대체 문안이 나온다 |
| 11 | 세션 도구 | 모델에게 다른 세션 목록을 물으면 도구가 없다고 답한다 |

## 9. 조사 요약 (2026-09-14)

에이전트 스킬의 근거다. 출처는 절 끝에 모았다.

**네이버.** AI 브리핑(2025-03, 통합검색 최상단 요약)과 대화형 AI 탭(2026-06-26 전체 공개)이 있고 적용 범위가 넓어지는 중이다. AI 브리핑 인용 실측 272건의 출처 분포는 블로그 158, 웹사이트 45, 네이버 DB 44, 카페 19, 지식iN 6 이다. **Top10 밖 인용이 49.3%** 로, 검색 순위가 낮아도 인용된다. 질의 유형별 Top10 중첩률은 정의형 28.6%, 전략형 90%, 비교형·상업형 100% 다. 건강기능식품은 **정보형**("성분명 + 효과·부작용·복용법")을 노린다. 상업형("제품 추천")에서는 AI 브리핑 자체가 잘 뜨지 않는다. 네이버 콘텐츠 5원칙(2026-05)은 직접 경험, 일관된 주제, 거짓 없는 진정성, 읽기 쉬운 구조, 최신성이고 기계 생성 글·짜깁기·과도한 홍보는 인용에서 빠진다. 크롤러 `Yeti` 허용이 전제다. 자사 웹사이트만 고쳐서는 인용의 절반도 못 먹는다는 것이 위 분포의 뜻이므로, 블로그 운영을 함께 제안하게 했다.

**해외 엔진.** GEO 논문(Aggarwal et al., KDD 2024)은 통계 추가·인용문·출처 명시가 가시성을 30~40% 올리고 **키워드 반복은 무효이거나 역효과**임을 보였다. 인용되는 페이지의 공통점은 섹션 첫머리 40~60단어 직답, 구체 수치, 표·목록, FAQPage/Article/Product 스키마, 엔티티 명칭 일관성, 분기 단위 갱신, 1차 출처 인라인 링크다. 인용 25,337건의 분포는 아티클 23.7%, 리스티클 19.6%, 제품 페이지 16.3% 이고 **비교 페이지가 리트리벌당 1.87회로 가장 높다.** 인용 텍스트의 엔티티 밀도는 20.6%(일반 7%). robots.txt 에서는 응답 크롤러(OAI-SearchBot, Claude-SearchBot, PerplexityBot)를 열어야 인용 대상이 되고, 학습 크롤러(GPTBot, ClaudeBot, Google-Extended)는 정책 선택이다. `llms.txt` 는 실측 효과가 거의 없어 후순위다.

**한국식 통이미지 상세페이지.** 개선 우선순위는 이미지 카피의 HTML 텍스트 이중 게재, 제품 스펙 HTML 표(원료명·1일 함량·기능성 내용·섭취량·유통기한·보관방법·제조사·총 내용량·원산지), 인증 명시(건강기능식품 인정번호, HACCP, GMP, 원료 특허 균주), FAQ 6~12문항, 섹션별 40~60단어 직답, 사실 서술 alt, JSON-LD, 비교 페이지 신설, 리뷰 확보 순이다.

**규제.** 건강기능식품은 질병 예방·치료 표현이 금지되고 기능성 표시·광고는 한국건강기능식품협회 자율심의 대상이다. **개정 건강기능식품법은 2026-10-08 시행**이다. 생성 문안은 모델 판단이 아니라 **금칙어 사전으로 하드 차단**해야 한다는 것이 `aeo-health-claims-guard` 를 사전 방식으로 만든 이유다.

**측정.** 고정 프롬프트 30~100개를 주 1회 네 엔진에 같은 질의로 넣어 브랜드 언급·인용 URL·긍부정·경쟁사 동시 노출을 기록하는 방식이 표준이다. 보조 지표는 서버 로그의 AI 크롤러 방문 빈도, `chatgpt.com`·`perplexity.ai` 리퍼러 유입, 검색 콘솔 노출 대비 클릭률이다. 상용 툴은 Profound, Peec AI, Otterly, Semrush AI Visibility, Ahrefs Brand Radar 가 있다.

### 출처

- https://www.navercorp.com/media/pressReleasesDetail?seq=34984
- https://blog.nasmedia.co.kr/entry/2606mediaissue-NAVER-AItap
- https://seonews.co.kr/naver-ai-briefing-geo-202605/
- https://seonews.co.kr/naver-ai-briefing-exposure-rules/
- https://1point.kr/blog/insights/naver-ai-briefing-content-design/
- https://searchadvisor.naver.com/guide/structured-data-faq
- https://arxiv.org/pdf/2311.09735 (GEO: Generative Engine Optimization, KDD 2024)
- https://blog.hubspot.com/marketing/answer-engine-optimization-best-practices
- https://www.deltavdigital.com/resources/reports/ai-citation-study/
- https://www.yotpo.com/blog/ecommerce-aeo/
- https://dev.to/brandswarm/robotstxt-for-ai-search-the-2026-cheat-sheet-gptbot-claudebot-and-the-rest-16a
- https://www.ascentkorea.com/text-image-seo/
- https://ad.khff.or.kr/

## 10. 아직 아닌 것

- **주기 모니터링·알림이 없다.** 프롬프트 세트를 주 1회 자동으로 돌려 노출 변화를 알리는 기능은 넣지 않았다. 이 에이전트는 요청받을 때 도는 대화형이다.
- **경쟁사 자동 추적이 없다.** 요청할 때마다 본다.
- **커머스 피드 정합성은 사람이 대조한다.** 스킬에 대조표 형식만 있고 피드를 직접 읽지는 않는다.
- **`dept-ceo` 에 사람이 둘 이상 들어가는 날** 4-1 (라) 첨부 경계를 다시 본다.
- **운영 실측을 하지 않았다.** 8절 검증 11항목은 배포 후에 채운다.

## 용어 설명

- **게이트웨이** - 모든 요청이 먼저 닿는 앞단 서버. 이 제품에서는 화면·인증·에이전트 실행을 이 서버가 맡는다.
- **에이전트** - 사용자와 대화하며 도구를 골라 쓰는 AI 비서 하나. 이름·모델·권한·작업 폴더를 따로 가진다.
- **워크스페이스** - 에이전트가 파일을 읽고 쓰는 자기 작업 폴더. 정체성 파일과 스킬이 여기에 놓인다.
- **스킬** - 특정 작업의 절차를 적어 둔 문서. 에이전트가 해당 작업을 만나면 이 문서를 열어 그대로 따른다.
- **크롤러** - 웹 페이지를 자동으로 읽어 가는 프로그램. 검색엔진과 AI 서비스가 각자의 크롤러를 운영한다.
- **robots.txt** - 사이트 최상위에 두는 텍스트 파일. 어느 크롤러가 어느 경로를 읽어도 되는지 적는다.
- **JSON-LD** - 페이지의 내용을 기계가 읽을 수 있는 형식으로 함께 적어 두는 방식. 제품명·가격·질문과 답 같은 것을 오해 없이 전달한다.
- **스키마** - JSON-LD 로 적는 그 구조의 규격. `Product`·`FAQPage` 처럼 대상의 종류마다 정해진 항목이 있다.
- **엔티티** - 검색엔진이 하나의 대상으로 인식하는 브랜드·제품·성분 같은 것. 표기가 갈리면 다른 대상으로 인식된다.
- **리트리벌** - 생성형 엔진이 답을 만들기 전에 근거 문서를 찾아 오는 단계.
