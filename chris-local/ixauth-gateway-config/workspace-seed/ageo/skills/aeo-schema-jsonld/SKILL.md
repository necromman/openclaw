---
name: aeo-schema-jsonld
description: 페이지의 JSON-LD 구조화 데이터를 뽑아 필수 속성을 검증하고 Product·FAQPage·BreadcrumbList·Organization 템플릿을 채워 준다. "스키마 넣어 줘", "구조화 데이터 확인", "리치 결과 안 나온다" 요청에 쓴다.
---

# 구조화 데이터(JSON-LD) 검증과 생성

네이버는 JSON-LD·마이크로데이터를 지식스니펫 근거로 쓰고, 생성엔진은 스키마가 있는 페이지를 더 잘 인용한다. 스키마는 "우리 페이지가 무엇에 대한 것인지" 를 기계가 오해 없이 읽게 하는 장치다.

## 1. 기존 스키마 추출

1. `web_fetch` 로 HTML 을 받아 `<script type="application/ld+json">` 블록을 전부 뽑는다.
2. 블록마다 JSON 파싱을 해 본다. **파싱 실패는 그 자체로 심각한 발견이다**(엔진이 통째로 버린다). 흔한 원인: 후행 쉼표, 홑따옴표, 이스케이프 안 된 따옴표, HTML 주석 삽입.
3. `@type` 을 모아 어떤 타입이 있고 없는지 표로 만든다.
4. 스크립트로 넣는 사이트가 많으므로, 블록이 없으면 `browser` 로 열어 다시 확인한다.

## 2. 있어야 하는 타입

| 타입 | 어떤 페이지에 | 없으면 |
| --- | --- | --- |
| `Product` (+`Offer`) | 상품 상세 | 가격·재고·브랜드가 답변에 실리지 않는다 |
| `FAQPage` | FAQ 가 있는 모든 페이지 | 질문 그대로의 질의에서 인용 기회를 잃는다 |
| `BreadcrumbList` | 모든 하위 페이지 | 카테고리 맥락이 사라진다 |
| `Organization` (+`sameAs`) | 홈·회사 소개 | 브랜드 엔티티가 다른 회사와 섞인다 |

## 3. 필수 속성 체크

### Product
필수: `name`, `image`, `description`, `brand`, `offers`
권장: `sku`, `gtin13`, `aggregateRating`, `review`, `additionalProperty`(원료·함량)

- `offers.price` 는 숫자만, `priceCurrency` 는 `KRW`.
- `availability` 는 `https://schema.org/InStock` 형식의 전체 URL.
- `aggregateRating` 은 **실제 리뷰가 있을 때만** 넣는다. 없는 별점을 넣는 것은 허위 표시다.
- `description` 은 페이지 본문과 같은 내용이어야 한다. 스키마와 화면이 다르면 양쪽 신뢰도가 떨어진다.

### FAQPage
필수: `mainEntity[]`, 각 항목의 `@type: Question`, `name`, `acceptedAnswer.text`
- **화면에 보이지 않는 질문을 스키마에만 넣지 않는다.** 규격 위반이고 적발되면 리치 결과가 통째로 꺼진다.
- 답변 텍스트는 화면 문구와 글자 그대로 같게 한다.

### BreadcrumbList
필수: `itemListElement[]`, 각 항목의 `position`, `name`, `item`(전체 URL)

### Organization
필수: `name`, `url`, `logo`
권장: `sameAs`(공식 채널 URL 배열), `address`, `telephone`
- `sameAs` 는 엔티티 통합의 핵심이다. 스마트스토어·인스타그램·블로그·유튜브 공식 계정 URL 을 전부 넣는다.

## 4. 템플릿

건강기능식품 상품 페이지 기준이다. `<...>` 를 실제 값으로 바꾸고, 값을 모르면 그 속성을 **지운다**. 빈 문자열이나 추정값을 넣지 않는다.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Product",
      "@id": "<페이지URL>#product",
      "name": "<제품명>",
      "image": ["<대표이미지URL>"],
      "description": "<40~60단어 직답. 화면 도입부와 같은 문장>",
      "sku": "<사내 품번>",
      "brand": { "@type": "Brand", "name": "<브랜드명>" },
      "manufacturer": { "@type": "Organization", "name": "<제조사>" },
      "additionalProperty": [
        { "@type": "PropertyValue", "name": "기능성 원료", "value": "<원료명>" },
        { "@type": "PropertyValue", "name": "1일 섭취량", "value": "<mg>" },
        { "@type": "PropertyValue", "name": "총 내용량", "value": "<g / 정>" },
        { "@type": "PropertyValue", "name": "건강기능식품 인정번호", "value": "<번호>" }
      ],
      "offers": {
        "@type": "Offer",
        "url": "<구매URL>",
        "price": "<숫자만>",
        "priceCurrency": "KRW",
        "availability": "https://schema.org/InStock",
        "seller": { "@type": "Organization", "name": "<판매자>" }
      }
    },
    {
      "@type": "FAQPage",
      "@id": "<페이지URL>#faq",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "<화면에 보이는 질문 그대로>",
          "acceptedAnswer": { "@type": "Answer", "text": "<화면에 보이는 답 그대로>" }
        }
      ]
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "홈", "item": "<홈URL>" },
        { "@type": "ListItem", "position": 2, "name": "<카테고리>", "item": "<카테고리URL>" },
        { "@type": "ListItem", "position": 3, "name": "<제품명>", "item": "<페이지URL>" }
      ]
    },
    {
      "@type": "Organization",
      "@id": "<홈URL>#org",
      "name": "<회사명>",
      "url": "<홈URL>",
      "logo": "<로고URL>",
      "sameAs": ["<스마트스토어>", "<블로그>", "<인스타그램>", "<유튜브>"]
    }
  ]
}
```

- `@graph` 로 묶으면 블록 하나로 네 타입을 다 넣을 수 있다. `@id` 로 서로를 가리키게 해 두면 엔진이 같은 대상으로 묶는다.
- `dateModified` 는 `Article`·`BlogPosting` 에 넣는다. 상품 페이지에는 대신 `offers.priceValidUntil` 을 갱신한다.

## 5. 문안 규제

스키마에 들어가는 `description`·FAQ 답변도 표시·광고다. 값을 채우기 전에 `aeo-health-claims-guard` 로 검사한다. 화면에서 걸러 낸 문구가 스키마에 남아 있는 사고가 흔하다.

## 6. 검증 도구

작성·수정 후 담당자가 돌릴 곳이다. 결과 화면을 캡처해 두라고 안내한다.

- Google Rich Results Test: https://search.google.com/test/rich-results
- Schema.org Validator: https://validator.schema.org/
- 네이버 서치어드바이저 구조화 데이터 안내: https://searchadvisor.naver.com/guide/structured-data-faq
- 네이버 서치어드바이저의 웹페이지 최적화 진단으로 수집 상태를 함께 본다.

## 7. 커머스 피드와의 정합성

- 구글 AI Mode·AI Overviews 의 상품 답변은 Merchant Center 피드에서 나온다. ChatGPT 쇼핑도 머천트가 제출한 피드(CSV/TSV/XML/JSON)를 쓴다.
- **페이지 Product 스키마의 값과 피드의 값이 다르면 양쪽 신뢰도가 함께 떨어진다.** 가격·재고·GTIN·브랜드명 네 가지는 반드시 같게 맞춘다.
- 피드가 있는지 담당자에게 확인하고, 있으면 표로 대조한다.

| 항목 | 페이지 스키마 | 피드 | 일치 |
| --- | --- | --- | --- |
