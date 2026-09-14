---
name: aeo-crawler-access
description: robots.txt 를 받아 네이버 Yeti·GPTBot·OAI-SearchBot·ClaudeBot·PerplexityBot 등 AI 크롤러의 허용 여부를 판정표로 낸다. "AI 검색에 안 나온다", "크롤러 막혔나", "robots 확인" 요청의 첫 단계다.
---

# AI 크롤러 접근 진단

인용되지 않는 페이지의 가장 흔한 원인은 콘텐츠가 아니라 **차단**이다. 다른 것을 보기 전에 이것을 먼저 본다.

## 1. 수집

```
web_fetch https://<도메인>/robots.txt
web_fetch https://<도메인>/sitemap.xml
web_fetch https://<도메인>/llms.txt
```

- 404 도 결과다. "robots.txt 없음 = 전면 허용" 이므로 없는 것이 문제인 경우는 드물다.
- `web_fetch` 가 막히면 `browser` 로 같은 주소를 연다.
- 페이지 HTML 의 `<meta name="robots">` 와 응답 헤더 `X-Robots-Tag` 도 본다. robots.txt 가 열려 있어도 이 둘이 `noindex` 면 막힌 것이다.

## 1-1. 라포르몰 현재 상태 (2026-09-14 실측, 점검 항목)

라포르몰 `robots.txt` 는 아래 두 줄뿐이다.

```
User-agent: *
Allow: /
```

점검할 때 이 세 가지를 매번 확인한다. 자세한 사실은 `COMPANY.md` 2절에 있다.

| 점검 항목 | 2026-09-14 상태 | 왜 보나 |
| --- | --- | --- |
| 고도몰 기본 봇 정책 적용 여부 | **미적용**. GPTBot·ClaudeBot·SemrushBot 차단 줄이 없어 AI 크롤러에 전면 개방 | 같은 법인 메디월드몰은 고도몰 기본값을 그대로 써서 GPTBot·ClaudeBot 이 차단된다. 경쟁사 가누다·지누스도 기본값이라 차단 상태다. 라포르몰의 개방은 구조적 우위이지만 설정·스킨을 건드리면 기본값으로 되돌아갈 수 있다 |
| 응답 크롤러 명시 Allow | **없음**(`*` 규칙에 우연히 걸려 열려 있는 상태) | OAI-SearchBot·ChatGPT-User·PerplexityBot·Claude-SearchBot 을 이름으로 적어 고정하는 것을 우선 작업 8번으로 제안한다 |
| `Sitemap:` 지시문 | **없음** | sitemap.xml 은 존재하지만 2020-05-15 생성 후 방치되어 194 URL 전부 `http://cstpillow.com`(비www·비https)이다. 지시문 추가는 sitemap 재생성과 함께 해야 의미가 있다 |

## 2. 크롤러 아홉 종

두 부류를 반드시 구분한다. **응답 크롤러**를 막으면 인용 자체가 불가능하고, **학습 크롤러**는 회사가 정책으로 선택하는 문제다. 이 둘을 섞어서 "AI 를 막자" 고 결정하면 노출을 잃는다.

| 크롤러 | 소유 | 부류 | 막히면 무슨 일이 나나 |
| --- | --- | --- | --- |
| `Yeti` | 네이버 | 수집 | 네이버 검색·AI 브리핑·AI 탭에서 사라진다. 국내 최우선 |
| `Googlebot` | 구글 | 수집 | 구글 검색과 AI Overviews 양쪽에서 사라진다 |
| `Bingbot` | 마이크로소프트 | 수집 | Bing 색인 상실. ChatGPT 검색 일부 경로에 영향 |
| `OAI-SearchBot` | OpenAI | 응답 | ChatGPT 검색 답변에 인용되지 않는다 |
| `GPTBot` | OpenAI | 학습 | 모델 학습에서 빠진다. 노출과는 직접 관계가 적다 |
| `Claude-SearchBot` | Anthropic | 응답 | Claude 검색 답변에 인용되지 않는다 |
| `ClaudeBot` | Anthropic | 학습 | 모델 학습에서 빠진다 |
| `PerplexityBot` | Perplexity | 응답 | Perplexity 출처 목록에서 사라진다 |
| `Google-Extended` | 구글 | 학습 | Gemini 학습에서 빠진다. 검색 색인과는 별개다 |

## 3. 판정 절차

robots.txt 는 위에서 아래로 읽되, **크롤러 이름이 정확히 일치하는 `User-agent` 블록이 있으면 그 블록만 적용되고 `User-agent: *` 는 무시된다.** 이 규칙을 놓치면 판정이 통째로 틀린다.

크롤러 하나마다 이렇게 판정한다.

1. 이름이 정확히 일치하는 `User-agent` 블록을 찾는다(대소문자 구분 없음).
2. 있으면 그 블록의 `Disallow`·`Allow` 만 본다. 없으면 `User-agent: *` 블록을 본다.
3. 대상 URL 경로에 대해 **더 긴 규칙이 이긴다**. 같은 길이면 `Allow` 가 이긴다.
4. `Disallow: /` 는 전면 차단, `Disallow:` (값 없음)는 전면 허용이다.

## 4. 판정표 형식

| 크롤러 | 부류 | 적용된 블록 | 판정 | 조치 |
| --- | --- | --- | --- | --- |
| Yeti | 수집 | `User-agent: *` | 허용 | - |
| OAI-SearchBot | 응답 | 블록 없음 -> `*` | 허용 | - |
| GPTBot | 학습 | `User-agent: GPTBot` | 차단 | 정책 확인 필요 |

표 아래에 결론을 한 줄로 쓴다.

- 응답 크롤러가 하나라도 차단이면: **"이 페이지는 지금 <엔진> 답변에 인용될 수 없다. 다른 개선보다 이것이 먼저다."**
- 전부 허용이면: **"접근은 열려 있다. 노출 문제의 원인은 콘텐츠 구조 쪽이다."** 로 넘기고 `aeo-page-audit` 로 간다.

## 5. 권장 robots.txt

응답 크롤러는 열고 학습 크롤러는 회사가 고르게 한다. 아래는 "노출은 최대, 학습은 거절" 을 고른 경우다. 결정은 사용자에게 물어본다.

**라포르몰에 적용할 때 주의한다.** 현재는 학습 크롤러까지 전면 개방이므로, 아래 예시를 그대로 넣으면 GPTBot·ClaudeBot 을 새로 차단하는 변경이 된다. 학습 차단을 원하는지 먼저 묻고, 원하지 않으면 그 세 블록을 빼고 응답 크롤러 명시 Allow 와 `Sitemap:` 지시문만 더한다. 응답 크롤러 목록에 `ChatGPT-User` 를 함께 적는다.

```
User-agent: Yeti
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: *
Allow: /

Sitemap: https://<도메인>/sitemap.xml
```

## 6. llms.txt

`/llms.txt` 는 사이트 구조를 LLM 에게 알려 준다는 제안 규격이다. **실측된 효과는 거의 없다.** 넣는 비용이 낮으니 넣어도 되지만 우선순위는 맨 뒤다. 있으면 "있음" 으로 기록만 하고, 없다고 해서 감점하지 않는다.

## 7. 그 밖에 막는 것들

robots.txt 가 열려 있는데도 크롤러가 못 들어가는 경우가 있다. 진단에 포함한다.

- **WAF·봇 차단**: Cloudflare 등의 봇 차단 규칙이 AI 크롤러 IP 를 막는다. 서버 로그에서 해당 User-agent 방문 기록을 확인하도록 담당자에게 요청한다.
- **로그인·나이 확인 게이트**: 크롤러는 통과하지 못한다.
- **`noindex` 메타**: robots.txt 와 별개다.
- **JS 로만 그리는 본문**: 크롤러가 텍스트를 못 본다. `web_fetch` 결과와 `browser` 결과의 차이로 확인한다.
- **정규 URL 불일치**: `canonical` 이 다른 주소를 가리키면 인용이 그쪽으로 간다.

## 8. 검증 지표

담당자에게 부탁할 사후 확인이다.

- 서버 로그에서 위 아홉 User-agent 의 방문 빈도(주 단위)
- `chatgpt.com`·`perplexity.ai` 리퍼러 유입
- 네이버 서치어드바이저의 수집 현황
- 설정·스킨을 고친 뒤 `robots.txt` 를 다시 받아 고도몰 기본 차단 정책이 되살아나지 않았는지 확인
