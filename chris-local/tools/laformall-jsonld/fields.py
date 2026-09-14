"""입력 필드 정본. GUI 폼·도움말 표·README 표·검증이 모두 이 표를 쓴다.

kind
  auto   페이지에서 채우고 사람이 고치지 않는다(읽기 전용)
  fixed  고정값
  entry  한 줄 입력
  combo  선택지
  area   여러 줄 입력
  props  키=값 여러 줄(additionalProperty 로 나간다)
  faq    질문·답변 쌍(FAQPage 스니펫으로 나간다)
"""

from __future__ import annotations

from dataclasses import dataclass, field

IN_STOCK = "https://schema.org/InStock"
OUT_OF_STOCK = "https://schema.org/OutOfStock"
PRE_ORDER = "https://schema.org/PreOrder"

AVAILABILITY = {
    "재고 있음": IN_STOCK,
    "품절": OUT_OF_STOCK,
    "예약 판매": PRE_ORDER,
}
AVAILABILITY_REVERSE = {v: k for k, v in AVAILABILITY.items()}
FAQ_ROWS = 5


@dataclass
class FieldSpec:
    key: str
    label: str
    required: bool
    kind: str
    placeholder: str = ""
    hint: str = ""
    options: tuple = ()
    width: int = 52
    rows: int = 3


FIELDS: list[FieldSpec] = [
    FieldSpec(
        "name",
        "상품명",
        True,
        "entry",
        "CST 스탠다드 마사지기",
        "AI 답변에 이 이름 그대로 실린다. 화면에 보이는 상품명과 글자까지 같게 쓴다.",
    ),
    FieldSpec(
        "url",
        "상품 URL",
        True,
        "auto",
        "https://cstpillow.com/goods/goods_view.php?goodsNo=11",
        "인용될 때 따라가는 주소다. goodsNo 로 자동으로 만든다.",
    ),
    FieldSpec(
        "goods_no",
        "sku (goodsNo)",
        True,
        "auto",
        "11",
        "상품을 구분하는 번호다. 같은 상품을 여러 번 인용해도 하나로 묶인다.",
        width=14,
    ),
    FieldSpec(
        "brand",
        "브랜드",
        True,
        "entry",
        "라포르",
        "브랜드 엔티티가 다른 회사와 섞이지 않게 한다.",
        width=24,
    ),
    FieldSpec(
        "seller",
        "판매자",
        True,
        "entry",
        "진바이오테크",
        "누가 파는지 없으면 답변에서 판매처가 빠진다.",
        width=24,
    ),
    FieldSpec(
        "price",
        "판매가 (숫자만)",
        True,
        "entry",
        "96000",
        "화면 판매가와 다르면 표시광고 위반이다. 쉼표·원 없이 숫자만 넣는다.",
        width=16,
    ),
    FieldSpec(
        "currency",
        "통화",
        True,
        "fixed",
        "KRW",
        "원화 고정이다.",
        width=10,
    ),
    FieldSpec(
        "availability_label",
        "재고 상태",
        True,
        "combo",
        "재고 있음",
        "품절 상품이 재고 있음으로 나가면 인용 신뢰도가 떨어진다.",
        options=("재고 있음", "품절", "예약 판매"),
        width=14,
    ),
    FieldSpec(
        "image",
        "대표 이미지 URL",
        True,
        "entry",
        "https://godomall.speedycdn.net/.../goods/11/image/main/11_main.jpg",
        "상품의 대표 사진(흰 배경 제품 사진) 한 장. 주소가 godomall.speedycdn.net 인 것은 "
        "고도몰이 이미지를 자체 서버에 두기 때문이며 정상입니다. 구글은 주소가 열리는지만 봅니다. "
        "아래 '이미지 고르기' 로 이 상품의 사진 중에서 고를 수 있습니다.",
    ),
    FieldSpec(
        "description",
        "설명 (2~3문장, 60~160자 권장)",
        True,
        "area",
        "목·어깨 속근육까지 깊게 자극하는 지압 마사지기. 하루 10분 사용 권장. 7일 무료체험 제공.",
        "AI 답변의 44%가 도입부에서 뽑힌다. 첫 두 문장에 결론을 담고 화면 문구와 같게 쓴다.",
        rows=4,
    ),
    FieldSpec(
        "category",
        "카테고리",
        True,
        "entry",
        "마사지기",
        "무슨 종류의 물건인지 알려 준다. 비교 질의에서 후보로 잡히는 근거가 된다.",
        width=28,
    ),
    FieldSpec(
        "material",
        "재질",
        True,
        "entry",
        "메모리폼, ABS",
        "소재 비교 질의에 그대로 인용된다. 라텍스·메모리폼 비교가 인용 1순위 포맷이다.",
        width=32,
    ),
    FieldSpec(
        "size",
        "크기",
        True,
        "entry",
        "가로 40cm x 세로 30cm x 높이 10cm",
        "수치가 있는 항목은 AI 답변에 그대로 인용된다. 높이 질의에 답할 수 있게 된다.",
    ),
    FieldSpec(
        "weight",
        "무게",
        True,
        "entry",
        "1.2kg",
        "숫자와 단위를 함께 쓴다. kg·g 를 알아서 구분한다.",
        width=16,
    ),
    FieldSpec(
        "color",
        "색상",
        True,
        "entry",
        "그레이",
        "색상 조건이 붙은 질의에서 걸러지지 않게 한다.",
        width=20,
    ),
    FieldSpec(
        "country",
        "원산지",
        True,
        "entry",
        "대한민국",
        "국내 제조 여부는 구매 질의에서 자주 묻는 항목이다.",
        width=20,
    ),
    FieldSpec(
        "manufacturer",
        "제조사",
        True,
        "entry",
        "진바이오테크",
        "브랜드와 제조사가 같아도 적어 둔다. 엔티티가 한쪽으로 모인다.",
        width=24,
    ),
    FieldSpec(
        "list_price",
        "정가 (참고용)",
        False,
        "entry",
        "132000",
        "화면 대조용으로만 쓴다. 스니펫에는 넣지 않는다(할인 표기는 별도 규정 대상).",
        width=16,
    ),
    FieldSpec(
        "mpn",
        "모델명 / mpn",
        False,
        "entry",
        "CST-STD",
        "같은 상품을 파는 다른 페이지와 한 상품으로 묶인다.",
        width=24,
    ),
    FieldSpec(
        "gtin13",
        "GTIN / 바코드 13자리",
        False,
        "entry",
        "8801234567893",
        "쇼핑 피드와 값이 맞아야 한다. 체크섬이 틀리면 생성할 때 알려 준다.",
        width=20,
    ),
    FieldSpec(
        "price_valid_until",
        "가격 유효일",
        False,
        "entry",
        "2026-12-31",
        "가격이 언제까지 유효한지 알린다. YYYY-MM-DD 형식이다.",
        width=16,
    ),
    FieldSpec(
        "shipping_fee",
        "배송비 (숫자만)",
        False,
        "entry",
        "0",
        "무료배송 여부는 구매 질의에서 가장 자주 비교되는 조건이다.",
        width=14,
    ),
    FieldSpec(
        "return_days",
        "반품 가능일 (일)",
        False,
        "entry",
        "14",
        "반품 기간을 숫자로 두면 조건 비교 질의에 답할 수 있다.",
        width=14,
    ),
    FieldSpec(
        "rating_value",
        "평점",
        False,
        "entry",
        "4.8",
        "화면에 실제 표시되는 값만 넣는다. 없는 별점은 허위 표시다.",
        width=10,
    ),
    FieldSpec(
        "review_count",
        "후기 수",
        False,
        "entry",
        "648",
        "평점과 함께 있어야 나간다. 집계 기준을 화면에도 적어 둔다.",
        width=12,
    ),
    FieldSpec(
        "extra_props",
        "추가 속성 (한 줄에 키=값)",
        False,
        "props",
        "1회 사용 시간=10분\n정격 전압=220V\n소음도=55dB",
        "수치 속성이 많을수록 인용 기회가 늘어난다. 사양서에 있는 값만 적는다.",
        rows=4,
    ),
    FieldSpec(
        "certs",
        "특허·인증 번호",
        False,
        "entry",
        "특허 제10-1234567호",
        "인증 정보는 이미지가 아니라 문자로 둬야 고시도 지키고 인용도 된다.",
    ),
    FieldSpec(
        "faq",
        "FAQ 질문·답변 (최대 5쌍)",
        False,
        "faq",
        "하루 몇 분 사용하나요?|1회 10분, 하루 2회를 권장합니다.",
        "질문 그대로의 질의에서 인용된다. 화면에 보이는 질문·답만 넣는다.",
    ),
]

# 페이지에서 자동으로 읽을 수 없어 사람이 직접 넣어야 하는 항목
MANUAL_ONLY = (
    "description",
    "category",
    "material",
    "size",
    "weight",
    "color",
    "country",
)

BY_KEY = {f.key: f for f in FIELDS}
REQUIRED_KEYS = [f.key for f in FIELDS if f.required]
OPTIONAL_KEYS = [f.key for f in FIELDS if not f.required]
EDITABLE_REQUIRED = [
    f.key for f in FIELDS if f.required and f.kind not in ("auto", "fixed")
]

EXAMPLE = {
    "name": "CST 스탠다드 마사지기",
    "brand": "라포르",
    "seller": "진바이오테크",
    "price": "96000",
    "availability_label": "재고 있음",
    "image": (
        "https://godomall.speedycdn.net/d91926a96caa32a81fcabebe1c5fa337"
        "/goods/11/image/detail/11_detail_046.jpg"
    ),
    "description": (
        "목·어깨 속근육까지 깊게 자극하는 지압 마사지기. 하루 10분 사용 권장. 7일 무료체험 제공."
    ),
    "category": "마사지기",
    "material": "ABS, 실리콘",
    "size": "가로 40cm x 세로 30cm x 높이 10cm",
    "weight": "1.2kg",
    "color": "그레이",
    "country": "대한민국",
    "manufacturer": "진바이오테크",
    "list_price": "132000",
    "mpn": "CST-STD",
    "gtin13": "",
    "price_valid_until": "2026-12-31",
    "shipping_fee": "0",
    "return_days": "7",
    "rating_value": "",
    "review_count": "",
    "extra_props": "1회 사용 시간=10분\n정격 전압=220V",
    "certs": "",
    "faq": [
        ("하루 몇 분 사용하나요?", "1회 10분, 하루 2회를 권장합니다."),
        ("무료체험 기간은 며칠인가요?", "7일 무료체험을 제공합니다."),
    ],
}


def missing_required(prod) -> list[str]:
    """비어 있는 필수 항목의 사람이 읽는 이름 목록."""
    out: list[str] = []
    for key in REQUIRED_KEYS:
        spec = BY_KEY[key]
        if spec.kind == "fixed":
            continue
        value = getattr(prod, key, "")
        if key == "availability_label":
            value = getattr(prod, "availability", "")
        if not str(value or "").strip():
            out.append(spec.label)
    return out


def required_table() -> list[tuple[str, str, str]]:
    return [(f.label, f.placeholder.replace("\n", " / "), f.hint) for f in FIELDS if f.required]


def optional_table() -> list[tuple[str, str, str]]:
    return [(f.label, f.placeholder.replace("\n", " / "), f.hint) for f in FIELDS if not f.required]


def markdown_table(rows: list[tuple[str, str, str]]) -> str:
    head = "| 항목 | 예시 | 왜 필요한지 |\n| --- | --- | --- |\n"
    body = "\n".join(f"| {a} | {b} | {c} |" for a, b, c in rows)
    return head + body


def text_table(rows: list[tuple[str, str, str]]) -> str:
    lines = []
    for label, example, hint in rows:
        lines.append(f"  {label}")
        lines.append(f"    예시: {example}")
        lines.append(f"    이유: {hint}")
    return "\n".join(lines)
