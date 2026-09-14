"""로컬 판정. 구글 Product 리치 결과 요구사항과 AEO 필수 항목을 규칙표로 검사한다.

이 판정은 참고용이다. 최종 판정은 구글 리치 결과 테스트다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import fields

STATUS_ERROR = "오류"
STATUS_WARN = "경고"
STATUS_PASS = "통과"
STATUS_NONE = "미검증"

INDICATOR = {
    STATUS_ERROR: "●",
    STATUS_WARN: "▲",
    STATUS_PASS: "✔",
    STATUS_NONE: "-",
}
COLOR = {
    STATUS_ERROR: "#ffe0e0",
    STATUS_WARN: "#fff4d0",
    STATUS_PASS: "#e2f4e2",
    STATUS_NONE: "#eeeeee",
}
FOREGROUND = {
    STATUS_ERROR: "#a00000",
    STATUS_WARN: "#8a5a00",
    STATUS_PASS: "#105010",
    STATUS_NONE: "#606060",
}

# 구글 Product 리치 결과 필수 속성
GOOGLE_REQUIRED = [
    ("name", "상품명(name)"),
    ("image", "대표 이미지(image)"),
    ("price", "판매가(offers.price)"),
    ("priceCurrency", "통화(offers.priceCurrency)"),
]
# 구글 권장 속성
GOOGLE_RECOMMENDED = [
    ("sku", "sku"),
    ("brand", "브랜드(brand)"),
    ("description", "설명(description)"),
    ("gtin_or_mpn", "GTIN 또는 모델명(gtin13/mpn)"),
    ("offer_url", "구매 URL(offers.url)"),
    ("availability", "재고 상태(offers.availability)"),
    ("priceValidUntil", "가격 유효일(offers.priceValidUntil)"),
    ("aggregateRating", "평점·후기 수(aggregateRating)"),
    ("shippingDetails", "배송비(offers.shippingDetails)"),
    ("hasMerchantReturnPolicy", "반품 정책(offers.hasMerchantReturnPolicy)"),
]
# AEO 필수(이 프로그램의 기준)
AEO_REQUIRED = [
    ("category", "카테고리"),
    ("material", "재질"),
    ("size", "크기"),
    ("weight", "무게"),
    ("color", "색상"),
    ("country", "원산지"),
    ("manufacturer", "제조사"),
]

DESC_MIN = 60
DESC_MAX = 160
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass
class Verdict:
    status: str = STATUS_NONE
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    missing: list = field(default_factory=list)

    @property
    def indicator(self) -> str:
        return INDICATOR.get(self.status, "-")

    def summary(self) -> str:
        if self.status == STATUS_PASS:
            return "통과"
        parts = []
        if self.errors:
            parts.append(f"오류 {len(self.errors)}")
        if self.warnings:
            parts.append(f"경고 {len(self.warnings)}")
        return " / ".join(parts) or self.status

    def report(self) -> str:
        lines = [f"로컬 판정: {self.status} ({self.summary()})"]
        if self.errors:
            lines.append("")
            lines.append("오류 (고쳐야 리치 결과가 나오지 않는다)")
            lines.extend(f"  - {e}" for e in self.errors)
        if self.warnings:
            lines.append("")
            lines.append("경고 (채우면 인용 기회가 늘어난다)")
            lines.extend(f"  - {w}" for w in self.warnings)
        lines.append("")
        lines.append("로컬 판정은 참고다. 최종 판정은 구글 리치 결과 테스트다.")
        return "\n".join(lines)


def gtin13_ok(value: str) -> bool:
    digits = re.sub(r"[^0-9]", "", value or "")
    if len(digits) != 13:
        return False
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(digits[:12]))
    return (10 - total % 10) % 10 == int(digits[12])


def _val(prod, key: str) -> str:
    return str(getattr(prod, key, "") or "").strip()


def check(prod, image_ok: bool | None = None) -> Verdict:
    verdict = Verdict()
    errors, warnings, missing = verdict.errors, verdict.warnings, verdict.missing

    # 구글 필수
    if not _val(prod, "name"):
        errors.append("상품명(name)이 비어 있습니다. 구글 필수 속성입니다")
        missing.append("상품명")
    image = _val(prod, "image")
    if not image:
        errors.append("대표 이미지(image)가 비어 있습니다. 구글 필수 속성입니다")
        missing.append("대표 이미지 URL")
    elif not image.startswith("http"):
        errors.append("대표 이미지 URL 이 절대 주소가 아닙니다")
    elif image_ok is False:
        errors.append("대표 이미지 URL HEAD 응답이 200 이 아닙니다")
    price = re.sub(r"[^0-9]", "", _val(prod, "price"))
    if not price:
        errors.append("판매가(offers.price)가 숫자가 아닙니다. 구글 필수 속성입니다")
        missing.append("판매가")
    elif int(price) <= 0:
        errors.append("판매가가 0 이하입니다")
    url = _val(prod, "url")
    if not re.match(r"^https?://[^\s/]+/goods/goods_view\.php\?goodsNo=\d+$", url):
        errors.append(f"상품 URL 이 고도몰 goods_view 형식이 아닙니다: {url or '(비어 있음)'}")
    if _val(prod, "availability") not in fields.AVAILABILITY.values():
        errors.append("재고 상태 값이 schema.org URL 형식이 아닙니다")

    # 설명
    desc = _val(prod, "description")
    if not desc:
        errors.append("설명(description)이 비어 있습니다. 직접 입력해야 합니다")
        missing.append("설명")
    elif len(desc) < DESC_MIN:
        warnings.append(f"설명이 {len(desc)}자입니다. {DESC_MIN}자 이상을 권장합니다")
    elif len(desc) > DESC_MAX * 2:
        warnings.append(f"설명이 {len(desc)}자입니다. {DESC_MAX}자 안팎으로 줄이면 도입부 인용에 유리합니다")

    # AEO 필수
    for key, label in AEO_REQUIRED:
        if not _val(prod, key):
            errors.append(f"{label}이(가) 비어 있습니다. 이 프로그램의 AEO 필수 항목입니다")
            missing.append(label)
    for key, label in (("brand", "브랜드"), ("seller", "판매자"), ("goods_no", "sku")):
        if not _val(prod, key):
            errors.append(f"{label}이(가) 비어 있습니다")
            missing.append(label)

    # 구글 권장
    if not (_val(prod, "gtin13") or _val(prod, "mpn")):
        warnings.append("GTIN 또는 모델명(mpn)이 없습니다. 같은 상품을 파는 다른 페이지와 묶이지 않습니다")
        missing.append("GTIN 또는 모델명")
    gtin = _val(prod, "gtin13")
    if gtin and not gtin13_ok(gtin):
        errors.append("GTIN 13자리 체크섬이 맞지 않습니다")
    pvu = _val(prod, "price_valid_until")
    if not pvu:
        warnings.append("가격 유효일(priceValidUntil)이 없습니다. 구글 권장 속성입니다")
        missing.append("가격 유효일")
    elif not DATE_RE.match(pvu):
        errors.append("가격 유효일은 YYYY-MM-DD 형식이어야 합니다")
    if not _val(prod, "shipping_fee"):
        warnings.append("배송비(shippingDetails)가 없습니다. 구글 권장 속성입니다")
        missing.append("배송비")
    if not _val(prod, "return_days"):
        warnings.append("반품 가능일(hasMerchantReturnPolicy)이 없습니다. 구글 권장 속성입니다")
        missing.append("반품 가능일")
    rating, reviews = _val(prod, "rating_value"), _val(prod, "review_count")
    if rating and not reviews:
        errors.append("평점만 있고 후기 수가 없습니다. 둘 다 있어야 나갑니다")
    elif reviews and not rating:
        errors.append("후기 수만 있고 평점이 없습니다. 둘 다 있어야 나갑니다")
    elif rating and reviews:
        try:
            if not 0 < float(rating) <= 5:
                errors.append("평점은 0 초과 5 이하여야 합니다")
            if int(reviews) <= 0:
                errors.append("후기 수는 1 이상이어야 합니다")
        except ValueError:
            errors.append("평점·후기 수가 숫자가 아닙니다")
    else:
        warnings.append("평점·후기 수(aggregateRating)가 없습니다. 화면에 표시되는 값이 있으면 넣으세요")
        missing.append("평점·후기 수")
    if not _val(prod, "extra_props"):
        warnings.append("추가 속성이 없습니다. 사용 시간·전압 같은 수치가 있으면 인용 기회가 늘어납니다")
        missing.append("추가 속성")
    if not getattr(prod, "faq", None):
        warnings.append("FAQ 가 없습니다. 질문 그대로의 질의에서 인용받는 가장 강한 포맷입니다")
        missing.append("FAQ")

    verdict.status = STATUS_ERROR if errors else (STATUS_WARN if warnings else STATUS_PASS)
    return verdict


def rule_table() -> list[tuple[str, str, str]]:
    rows = [(label, "구글 필수", "없으면 리치 결과가 나오지 않는다") for _, label in GOOGLE_REQUIRED]
    rows += [(label, "구글 권장", "채우면 리치 결과에 더 많은 정보가 실린다") for _, label in GOOGLE_RECOMMENDED]
    rows += [(label, "AEO 필수", "AI 답변에 인용되는 사양 수치다") for _, label in AEO_REQUIRED]
    return rows
