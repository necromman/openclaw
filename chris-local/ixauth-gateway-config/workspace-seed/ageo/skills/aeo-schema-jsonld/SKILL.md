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
- `sameAs` 는 엔티티 통합의 핵심이다. 공식 채널 URL 을 전부 넣는다. 라포르몰은 인스타그램 `@jinbiotech`, 유튜브 채널 "라포르", 카카오 채널, 그룹 사이트 `www.jinbiotech.co.kr` 이 있고 네이버 블로그는 없다(2026-09-14).

## 4. 템플릿

라포르몰 베개·마사지기 상품 페이지 기준이다. `<...>` 를 실제 값으로 바꾸고, 값을 모르면 그 속성을 **지운다**. 빈 문자열이나 추정값을 넣지 않는다.

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
        { "@type": "PropertyValue", "name": "소재", "value": "<커버 섬유 조성·혼용률 / 충전재>" },
        { "@type": "PropertyValue", "name": "크기", "value": "<가로 x 세로 x 높이 cm>" },
        { "@type": "PropertyValue", "name": "높이", "value": "<정자세 Xcm / 측면 Ycm>" },
        { "@type": "PropertyValue", "name": "경도", "value": "<레귤러 소프트 / 엑스트라 소프트>" },
        { "@type": "PropertyValue", "name": "세탁방법", "value": "<커버 분리 세탁 가능 여부>" },
        { "@type": "PropertyValue", "name": "제조국", "value": "<제조국>" }
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

스키마에 들어가는 `description`·FAQ 답변도 표시·광고다. 값을 채우기 전에 `ageo-claims-guard` 로 검사한다. 화면에서 걸러 낸 문구가 스키마에 남아 있는 사고가 흔하다.

- `additionalProperty` 에 **KC 인증번호를 넣지 않는다.** 성인용 베개는 KC 대상이 아니다.
- `description` 에 거북목 교정·목디스크 완화 같은 의료적 효능 표현을 넣지 않는다. 물리 사양과 사용 경험으로 쓴다.
- `aggregateRating` 은 실제 후기가 있을 때만 넣는다. 라포르몰 바로베개는 2026-09-14 기준 648건이며, "고객만족도 99%" 같은 수치는 실증자료가 확인되기 전에는 쓰지 않는다.

## 5-1. 고도몰5 전 상품 자동 주입 절차

라포르몰은 2026-09-14 기준 JSON-LD 가 0건이다. 상품마다 손으로 넣지 않고 스킨 템플릿 한 곳에 치환코드로 심어 전 상품에 자동 적용한다.

1. 관리자 > 디자인 > 상품상세 템플릿 `goods/goods_view.htm` 을 연다. PC 스킨과 모바일 스킨을 각각 고친다(도메인이 `www` 와 `m` 으로 갈려 있다).
2. 템플릿 안에 `<script type="application/ld+json">` 블록을 하나 넣고 값은 치환코드로 채운다. 상품명 `{=goodsView['goodsNm']}`, 판매가 `{=goodsView['goodsPrice']}` 처럼 쓴다. 실제 변수명은 스킨 버전마다 다르므로, 템플릿에 이미 쓰여 있는 표기를 그대로 따르고 확인되지 않은 변수명을 추측해 넣지 않는다.
3. **URL 은 `goods_view.php?goodsNo=N` 형식으로 고정한다.** 고도몰5 의 상품 주소는 이 형태이고 슬러그 주소는 지원 여부가 확인되지 않았다. `@id`·`offers.url`·`BreadcrumbList` 의 마지막 `item` 을 모두 `https://www.cstpillow.com/goods/goods_view.php?goodsNo={=goodsView['goodsNo']}` 형태로 맞춘다.
4. 가격은 숫자만 남긴다. 치환코드가 `115,000` 처럼 쉼표를 포함해 내려오면 스키마 값이 깨지므로 쉼표를 없앤 변수나 템플릿 필터를 쓴다. 넣은 뒤 Rich Results Test 로 실제 값을 확인한다.
5. `Organization` 은 상품 템플릿이 아니라 공통 레이아웃(`outline/_header.htm`)에 한 번만 넣는다. 상품 템플릿에 넣으면 상품 수만큼 중복된다.
6. **canonical 을 함께 켠다.** 설정 > 기본정책 > 검색엔진 최적화의 "대표 URL 사용" 을 켜면 전 페이지 `<head>` 에 canonical 이 자동 삽입된다. 지금은 꺼져 있어서 `www.cstpillow.com` 과 `m.cstpillow.com` 의 같은 상품이 서로 중복 콘텐츠가 되고, JSON-LD 의 `@id` 와 화면 주소가 어긋난 채 두 도메인에 같은 스키마가 실린다. 스키마 주입과 canonical 은 같이 처리한다.
7. 모바일 스킨의 `@id`·`offers.url` 도 `www` 정본 주소를 가리키게 한다. canonical 과 스키마가 같은 주소를 말해야 인용이 한쪽으로 모인다.
8. 넣은 뒤 상품 3개 이상을 실제로 열어 값이 상품마다 바뀌는지 확인한다. 템플릿 오류는 전 상품에 동시에 퍼진다.

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
