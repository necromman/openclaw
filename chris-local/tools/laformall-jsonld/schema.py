"""Product JSON-LD 생성·검증.

출력은 사용자가 goodsNo=11 에 넣어 구글 리치 결과 테스트에서
"유효한 항목 2개 감지" 를 받은 스니펫과 같은 구조·들여쓰기(2칸)·한글 그대로다.
brand·seller 처럼 값이 전부 스칼라이고 짧은 객체는 한 줄로 접는다.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime

SCRIPT_OPEN = '<script type="application/ld+json">'
SCRIPT_CLOSE = "</script>"
INLINE_LIMIT = 80


def _is_scalar(value) -> bool:
    return isinstance(value, (str, int, float, bool)) or value is None


def _enc(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _inline(obj) -> str | None:
    if isinstance(obj, dict):
        if not all(_is_scalar(v) for v in obj.values()):
            return None
        body = ", ".join(f"{_enc(k)}: {_enc(v)}" for k, v in obj.items())
        text = "{ " + body + " }"
    elif isinstance(obj, list):
        if not all(_is_scalar(v) for v in obj):
            return None
        text = "[" + ", ".join(_enc(v) for v in obj) + "]"
    else:
        return None
    return text if len(text) <= INLINE_LIMIT else None


def dump(obj, depth: int = 0) -> str:
    """2칸 들여쓰기 + 짧은 스칼라 객체 인라인 직렬화."""
    pad = "  " * depth
    inner = "  " * (depth + 1)
    if _is_scalar(obj):
        return _enc(obj)
    flat = _inline(obj)
    if flat is not None:
        return flat
    if isinstance(obj, dict):
        parts = [f"{inner}{_enc(k)}: {dump(v, depth + 1)}" for k, v in obj.items()]
        return "{\n" + ",\n".join(parts) + "\n" + pad + "}"
    if isinstance(obj, list):
        parts = [f"{inner}{dump(v, depth + 1)}" for v in obj]
        return "[\n" + ",\n".join(parts) + "\n" + pad + "]"
    return _enc(str(obj))


def wrap(obj) -> str:
    return f"{SCRIPT_OPEN}\n{dump(obj)}\n{SCRIPT_CLOSE}"


# ---------------------------------------------------------------------- 생성


WEIGHT_UNITS = [("kg", "KGM"), ("킬로", "KGM"), ("g", "GRM"), ("그램", "GRM")]


def parse_weight(text: str) -> dict | None:
    """'1.2kg' 을 QuantitativeValue 로 만든다."""
    text = (text or "").strip()
    if not text:
        return None
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", text)
    if not match:
        return None
    unit = "KGM"
    low = text.lower()
    for token, code in WEIGHT_UNITS:
        if token in low:
            unit = code
            break
    return {"@type": "QuantitativeValue", "value": match.group(1), "unitCode": unit}


def _shipping(fee: str) -> dict:
    return {
        "@type": "OfferShippingDetails",
        "shippingRate": {
            "@type": "MonetaryAmount",
            "value": re.sub(r"[^0-9]", "", fee) or "0",
            "currency": "KRW",
        },
        "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "KR"},
    }


def _return_policy(days: str) -> dict:
    return {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": "KR",
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
        "merchantReturnDays": int(re.sub(r"[^0-9]", "", days) or 0),
        "returnMethod": "https://schema.org/ReturnByMail",
    }


def build_product(
    prod,
    price_valid_until: str = "",
    rating_value: str = "",
    review_count: str = "",
) -> dict:
    def val(key: str) -> str:
        return str(getattr(prod, key, "") or "").strip()

    data: dict = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": (prod.name or "").strip(),
        "brand": {"@type": "Brand", "name": (prod.brand or "라포르").strip()},
        "description": (prod.description or "").strip(),
        "image": (prod.image or "").strip(),
        "sku": str(prod.goods_no),
    }
    if not data["image"]:
        data.pop("image")
    if not data["description"]:
        data.pop("description")
    # 여기부터는 값이 있을 때만 넣는다.
    if val("category"):
        data["category"] = val("category")
    if val("material"):
        data["material"] = val("material")
    if val("size"):
        data["size"] = val("size")
    weight = parse_weight(val("weight"))
    if weight:
        data["weight"] = weight
    if val("color"):
        data["color"] = val("color")
    if val("country"):
        data["countryOfOrigin"] = {"@type": "Country", "name": val("country")}
    if val("manufacturer"):
        data["manufacturer"] = {"@type": "Organization", "name": val("manufacturer")}
    if val("mpn"):
        data["mpn"] = val("mpn")
    gtin = re.sub(r"[^0-9]", "", val("gtin13"))
    if gtin:
        data["gtin13"] = gtin
    pairs = prod.prop_pairs() if hasattr(prod, "prop_pairs") else []
    if pairs:
        data["additionalProperty"] = [
            {"@type": "PropertyValue", "name": key, "value": value} for key, value in pairs
        ]
    rating = (rating_value or val("rating_value")).strip()
    reviews = (review_count or val("review_count")).strip()
    if rating and reviews:
        data["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": rating,
            "reviewCount": reviews,
        }
    offer: dict = {
        "@type": "Offer",
        "url": prod.url,
        "priceCurrency": "KRW",
        "price": re.sub(r"[^0-9]", "", str(prod.price or "")),
        "availability": prod.availability,
        "seller": {
            "@type": "Organization",
            "name": (prod.seller or "진바이오테크").strip(),
        },
    }
    pvu = (price_valid_until or val("price_valid_until")).strip()
    if pvu:
        items = list(offer.items())
        idx = [i for i, (k, _) in enumerate(items) if k == "price"][0]
        items.insert(idx + 1, ("priceValidUntil", pvu))
        offer = dict(items)
    if val("shipping_fee"):
        offer["shippingDetails"] = _shipping(val("shipping_fee"))
    if val("return_days"):
        offer["hasMerchantReturnPolicy"] = _return_policy(val("return_days"))
    data["offers"] = offer
    return data


def build_faq(prod) -> dict | None:
    pairs = prod.faq_pairs() if hasattr(prod, "faq_pairs") else []
    if not pairs:
        return None
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": question,
                "acceptedAnswer": {"@type": "Answer", "text": answer},
            }
            for question, answer in pairs
        ],
    }


def faq_snippet(prod) -> str:
    data = build_faq(prod)
    return wrap(data) if data else ""


def build_breadcrumb(prod, domain: str = "https://cstpillow.com") -> dict:
    home = (domain or "https://cstpillow.com").rstrip("/") + "/"
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": home},
            {
                "@type": "ListItem",
                "position": 2,
                "name": (prod.name or "").strip(),
                "item": prod.url,
            },
        ],
    }


def snippet(prod, **kwargs) -> str:
    return wrap(build_product(prod, **kwargs))


def breadcrumb_snippet(prod, domain: str = "https://cstpillow.com") -> str:
    return wrap(build_breadcrumb(prod, domain))


# ---------------------------------------------------------------------- 검증


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate(prod, data: dict, image_ok: bool | None = None, image_size: tuple | None = None) -> list[str]:
    """생성 전 검증. 오류 문자열 목록을 낸다(빈 목록이면 통과).

    항목별 규칙은 validator 의 규칙표를 그대로 쓰고, 여기서는 직렬화한
    JSON 이 실제로 파싱되는지를 더 본다.
    """
    import validator

    errors = list(validator.check(prod, image_ok, image_size).errors)
    try:
        json.loads(dump(data))
    except Exception as exc:
        errors.append(f"JSON 파싱 실패: {exc}")
    faq = build_faq(prod)
    if faq:
        try:
            json.loads(dump(faq))
        except Exception as exc:
            errors.append(f"FAQ JSON 파싱 실패: {exc}")
    return errors


def full_snippet(prod, with_breadcrumb: bool = False, domain: str = "", **kwargs) -> str:
    """Product 블록 + (있으면) FAQPage 블록 + (선택) BreadcrumbList 블록."""
    blocks = [wrap(build_product(prod, **kwargs))]
    faq = faq_snippet(prod)
    if faq:
        blocks.append(faq)
    if with_breadcrumb:
        blocks.append(breadcrumb_snippet(prod, domain or "https://cstpillow.com"))
    return "\n\n".join(blocks)


# ---------------------------------------------------------------------- 파일명


def safe_name(text: str, limit: int = 60) -> str:
    text = (text or "").strip()
    text = re.sub(r"[\\/:*?\"<>|\r\n\t]", "", text)
    text = re.sub(r"\s+", "_", text)
    return text[:limit] or "no-name"


def file_name(prod) -> str:
    return f"goodsNo-{prod.goods_no}-{safe_name(prod.name)}.html"


def bundle_name(now: datetime | None = None) -> str:
    now = now or datetime.now()
    return f"all-{now.strftime('%Y%m%d-%H%M')}.txt"


def snippet_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]
