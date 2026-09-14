"""라포르몰(고도몰5) 상품 페이지 수집·파싱.

셀렉터는 2026-09-14 실측(goodsNo 7·11·12)으로 확인한 것이다.
  상품명   og:title -> div.item_detail_tit h3 -> title
  판매가   dl.item_price dd (strong 중첩) -> dt 텍스트가 판매가인 dl -> "원" 앞 숫자 정규식
  정가     div.item_detail_list 안에서 dt 가 정가인 dl 의 dd del span
  이미지   og:image -> div.detail_cont img 첫 장 -> div.detail_explain_box img
  재고     구매 영역의 품절 마크업(btn_add_soldout) -> ENP_VAR.soldOut 첫 렌더 값
"""

from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import dataclass, field, asdict
from datetime import datetime

import requests
from bs4 import BeautifulSoup

GOODS_PATH = "/goods/goods_view.php?goodsNo="
IN_STOCK = "https://schema.org/InStock"
OUT_OF_STOCK = "https://schema.org/OutOfStock"


@dataclass
class Product:
    goods_no: str = ""
    url: str = ""
    name: str = ""
    price: str = ""
    list_price: str = ""
    image: str = ""
    description: str = ""
    availability: str = IN_STOCK
    brand: str = "라포르"
    seller: str = "진바이오테크"
    # AEO 필수 항목
    category: str = ""
    material: str = ""
    size: str = ""
    weight: str = ""
    color: str = ""
    country: str = ""
    manufacturer: str = ""
    # 선택 항목
    mpn: str = ""
    gtin13: str = ""
    price_valid_until: str = ""
    shipping_fee: str = ""
    return_days: str = ""
    rating_value: str = ""
    review_count: str = ""
    extra_props: str = ""
    certs: str = ""
    faq: list = field(default_factory=list)
    # 상태
    has_ldjson: bool = False
    exposed: str = ""
    sale_state: str = ""
    filled_from_page: bool = False
    page_state: str = ""
    image_candidates: list = field(default_factory=list)
    applied: str = ""
    applied_detail: str = ""
    applied_at: str = ""  # 페이지 적용을 마지막으로 확인한 시각
    applied_new: bool = False  # 지난 회차에 미적용이었다가 이번에 적용된 상품
    local_status: str = ""
    google_status: str = ""
    google_at: str = ""
    status: str = ""
    error: str = ""
    selected: bool = True
    warnings: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)

    @property
    def stock_label(self) -> str:
        from fields import AVAILABILITY_REVERSE

        return AVAILABILITY_REVERSE.get(self.availability, "재고 있음")

    def prop_pairs(self) -> list[tuple[str, str]]:
        """추가 속성 텍스트(한 줄에 키=값)와 특허·인증 번호를 쌍 목록으로 만든다."""
        pairs: list[tuple[str, str]] = []
        for line in (self.extra_props or "").splitlines():
            line = line.strip()
            if not line or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if key and value:
                pairs.append((key, value))
        if (self.certs or "").strip():
            pairs.append(("특허·인증", self.certs.strip()))
        return pairs

    def faq_pairs(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for item in self.faq or []:
            try:
                question, answer = item[0], item[1]
            except Exception:
                continue
            if str(question).strip() and str(answer).strip():
                out.append((str(question).strip(), str(answer).strip()))
        return out

    def claim_fields(self) -> dict:
        """규제 검사 대상 문자열 모음."""
        out = {"상품명": self.name, "설명": self.description}
        for key, value in self.prop_pairs():
            out[f"추가 속성 {key}"] = value
        for index, (question, answer) in enumerate(self.faq_pairs(), 1):
            out[f"FAQ {index} 질문"] = question
            out[f"FAQ {index} 답변"] = answer
        return out


def normalize_goods_no(token: str) -> str | None:
    """URL 또는 숫자 토큰에서 goodsNo 를 뽑는다."""
    token = (token or "").strip().strip(",;\"'")
    if not token:
        return None
    if token.isdigit():
        return token
    m = re.search(r"goodsNo=(\d+)", token)
    if m:
        return m.group(1)
    m = re.search(r"(\d{1,7})\s*$", token)
    if m and "cstpillow" in token:
        return m.group(1)
    return None


def parse_input(text: str) -> tuple[list[str], list[str]]:
    """여러 줄 입력에서 goodsNo 목록과 해석 실패 토큰을 낸다(중복 제거, 순서 유지)."""
    tokens = re.split(r"[\s,;]+", text or "")
    found: list[str] = []
    bad: list[str] = []
    for tok in tokens:
        if not tok.strip():
            continue
        gn = normalize_goods_no(tok)
        if gn:
            if gn not in found:
                found.append(gn)
        else:
            bad.append(tok.strip())
    return found, bad


def product_url(goods_no: str, domain: str) -> str:
    base = (domain or "https://cstpillow.com").rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    return f"{base}{GOODS_PATH}{goods_no}"


class Fetcher:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.discovered_categories: list[str] = []
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": cfg.get("user_agent", ""),
                "Accept-Language": "ko-KR,ko;q=0.9",
                "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            }
        )

    # ------------------------------------------------------------------ 저수준
    def get(self, url: str) -> requests.Response:
        timeout = int(self.cfg.get("timeout", 20))
        retries = int(self.cfg.get("retries", 2))
        last: Exception | None = None
        for attempt in range(retries + 1):
            try:
                resp = self.session.get(url, timeout=timeout, allow_redirects=True)
                resp.raise_for_status()
                resp.encoding = "utf-8"
                return resp
            except Exception as exc:  # 재시도
                last = exc
        raise RuntimeError(f"{type(last).__name__}: {last}")

    def head_ok(self, url: str) -> bool:
        if not url:
            return False
        timeout = int(self.cfg.get("timeout", 20))
        try:
            resp = self.session.head(url, timeout=timeout, allow_redirects=True)
            if resp.status_code == 405:
                resp = self.session.get(url, timeout=timeout, stream=True)
            return resp.status_code == 200
        except Exception:
            return False

    # ------------------------------------------------------------------ 사이트맵
    def sitemap_goods(self) -> list[str]:
        url = self.cfg.get("sitemap_url") or "https://www.cstpillow.com/sitemap.xml"
        resp = self.get(url)
        nums = re.findall(r"goodsNo=(\d+)", resp.text)
        out: list[str] = []
        for n in nums:
            if n not in out:
                out.append(n)
        out.sort(key=lambda x: int(x))
        return out

    # ------------------------------------------------------------------ 판매 중 상품
    def discover_live_goods(
        self, max_pages: int = 8, progress=None, should_stop=None
    ) -> tuple[list[str], dict[str, list[str]]]:
        """지금 라포르몰에 진열된 상품을 목록 페이지에서 직접 모은다.

        사이트맵은 2020년에 만들어진 파일이라 현재 진열과 다르다. 그래서
        메인, 빈 검색, 카테고리 목록(페이지네이션 포함)을 실제로 받아 모은다.
        (goodsNo 목록, {goodsNo: 나온 페이지 목록}) 을 낸다.
        """
        base = (self.cfg.get("fetch_domain") or self.cfg.get("domain", "")).rstrip("/")
        found: dict[str, list[str]] = {}
        seen_pages: set[str] = set()
        categories: list[str] = []

        def scan(path: str) -> list[str]:
            url = path if path.startswith("http") else base + path
            if url in seen_pages:
                return []
            seen_pages.add(url)
            try:
                resp = self.get(url)
            except Exception:
                return []
            label = url[len(base) :] or "/"
            numbers = re.findall(r"goodsNo=(\d+)", resp.text)
            for number in numbers:
                found.setdefault(number, [])
                if label not in found[number]:
                    found[number].append(label)
            for code in re.findall(r"cateCd=([0-9a-zA-Z]{3,})", resp.text):
                if code not in categories:
                    categories.append(code)
            return numbers

        if progress:
            progress(0, None, "메인 페이지 확인")
        scan("/")
        if progress:
            progress(0, None, "전체 검색 결과 확인")
        scan("/goods/goods_search.php?keyword=")
        scan("/goods/goods_list.php")
        index = 0
        while index < len(categories):
            if should_stop and should_stop():
                break
            code = categories[index]
            index += 1
            if progress:
                progress(index, len(categories), f"카테고리 {code} 확인")
            for page in range(1, max_pages + 1):
                numbers = scan(f"/goods/goods_list.php?cateCd={code}&page={page}")
                if not numbers:
                    break
        goods = sorted(found, key=lambda x: int(x))
        self.discovered_categories = list(categories)
        return goods, found

    # ------------------------------------------------------------------ 상품 수집
    def fetch_product(self, goods_no: str) -> Product:
        out_domain = self.cfg.get("domain", "https://cstpillow.com")
        fetch_domain = self.cfg.get("fetch_domain") or out_domain
        prod = Product(
            goods_no=goods_no,
            url=product_url(goods_no, out_domain),
            brand=self.cfg.get("brand", "라포르"),
            seller=self.cfg.get("seller", "진바이오테크"),
        )
        try:
            resp = self.get(product_url(goods_no, fetch_domain))
        except Exception as exc:
            prod.status = "수집 실패"
            prod.error = str(exc)
            return prod
        if len(resp.text) < 2000 and "goodsNo" not in resp.text:
            # 삭제·미노출 상품은 고도몰이 빈 껍데기 페이지를 준다(실측 450바이트).
            prod.status = "페이지 접근 불가"
            prod.page_state = "접근 불가"
            prod.error = "상품 페이지를 열 수 없습니다(삭제되었거나 접근이 막힌 상품)"
            return prod
        soup = BeautifulSoup(resp.text, "html.parser")
        prod.page_state = "정상"
        prod.name = _pick_name(soup)
        prod.price = _pick_price(soup, resp.text)
        prod.list_price = _pick_list_price(soup)
        og_image = _pick_image(soup, resp.url)
        import images

        prod.image_candidates = images.candidates(
            resp.text, resp.url, prod.goods_no, og_image
        )
        prod.image = images.default_image(prod.image_candidates, og_image)
        prod.availability = _pick_availability(soup, resp.text)
        prod.manufacturer = _pick_info(soup, ("제조사", "제조원")) or self.cfg.get("seller", "")
        prod.country = _pick_info(soup, ("원산지", "제조국"))
        blocks = soup.find_all("script", type="application/ld+json")
        prod.has_ldjson = bool(blocks)
        prod.applied, prod.applied_detail = _apply_existing(prod, blocks)
        prod.applied_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        prod.status = "수집됨"
        if not prod.name:
            prod.warnings.append("상품명을 찾지 못했습니다")
        if not prod.price:
            prod.warnings.append("판매가를 찾지 못했습니다")
        if not prod.image:
            prod.warnings.append("이미지를 찾지 못했습니다")
        # 설명은 사이트 meta description 이 전 페이지 공통이라 그것으로는 채우지 않는다.
        # 페이지에 이미 ld+json 정보표가 있으면 그 값은 위에서 가져왔다.
        return prod

    # ------------------------------------------------------------------ 적용 확인
    def verify_applied(self, goods_no: str) -> tuple[str, str]:
        """(판정, 상세) 를 낸다. 판정은 적용됨/미적용/가격 불일치/JSON 오류/확인 실패."""
        fetch_domain = self.cfg.get("fetch_domain") or self.cfg.get("domain")
        try:
            resp = self.get(product_url(goods_no, fetch_domain))
        except Exception as exc:
            return "확인 실패", str(exc)
        soup = BeautifulSoup(resp.text, "html.parser")
        blocks = soup.find_all("script", type="application/ld+json")
        if not blocks:
            return "미적용", "페이지에 ld+json 블록이 없습니다"
        page_price = _digits(_pick_price(soup, resp.text))
        prices: list[str] = []
        for blk in blocks:
            raw = blk.string or blk.get_text() or ""
            try:
                data = json.loads(raw)
            except Exception as exc:
                return "JSON 오류", f"ld+json 파싱 실패: {exc}"
            prices.extend(_collect_prices(data))
        if not prices:
            return "적용됨", "Product offers.price 를 찾지 못했습니다(다른 타입일 수 있음)"
        if page_price and page_price not in prices:
            return "가격 불일치", f"스키마 {'/'.join(prices)} vs 화면 {page_price}"
        return "적용됨", f"블록 {len(blocks)}개, price {'/'.join(prices)}"


# ---------------------------------------------------------------------- 파서 조각


def _text(node) -> str:
    return " ".join(node.get_text(" ", strip=True).split()) if node else ""


def _digits(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def _pick_name(soup: BeautifulSoup) -> str:
    meta = soup.find("meta", property="og:title")
    if meta and (meta.get("content") or "").strip():
        return meta["content"].strip()
    for sel in ("div.item_detail_tit h3", "div.item_detail_tit .tit", "h3"):
        node = soup.select_one(sel)
        name = _text(node)
        if name and name not in ("관련 상품", "상품상세정보"):
            return name
    title = _text(soup.find("title"))
    return title


def _pick_price(soup: BeautifulSoup, raw: str) -> str:
    node = soup.select_one("dl.item_price dd")
    value = _digits(_text(node))
    if value:
        return value
    for dl in soup.select("div.item_detail_list dl, dl"):
        dt = dl.find("dt")
        if dt and _text(dt) in ("판매가", "할인판매가", "소비자가"):
            value = _digits(_text(dl.find("dd")))
            if value:
                return value
    m = re.search(r"판매가[^0-9]{0,40}([0-9][0-9,]{2,})\s*원", raw)
    if m:
        return _digits(m.group(1))
    m = re.search(r"([0-9]{1,3}(?:,[0-9]{3})+)\s*원", raw)
    return _digits(m.group(1)) if m else ""


def _apply_existing(prod: Product, blocks) -> tuple[str, str]:
    """페이지에 이미 있는 Product 정보표를 읽어 폼을 채우고 적용 여부를 판정한다."""
    if not blocks:
        return "미적용", "페이지에 ld+json 블록이 없습니다"
    page_price = re.sub(r"[^0-9]", "", str(prod.price or ""))
    found_product = False
    schema_price = ""
    for block in blocks:
        raw = block.string or block.get_text() or ""
        try:
            data = json.loads(raw)
        except Exception as exc:
            return "미확인", f"ld+json 파싱 실패: {exc}"
        for node in _iter_nodes(data):
            if str(node.get("@type", "")).lower() != "product":
                continue
            found_product = True
            schema_price = _fill_from_product(prod, node) or schema_price
    if not found_product:
        return "미확인", "Product 정보표를 찾지 못했습니다(다른 타입일 수 있음)"
    prod.filled_from_page = True
    if page_price and schema_price and page_price != schema_price:
        return "적용됨(가격 불일치)", f"정보표 {schema_price} vs 화면 {page_price}"
    return "적용됨(가격 일치)", f"블록 {len(blocks)}개, price {schema_price or '없음'}"


def _iter_nodes(data):
    if isinstance(data, dict):
        if "@graph" in data and isinstance(data["@graph"], list):
            for item in data["@graph"]:
                yield from _iter_nodes(item)
        yield data
    elif isinstance(data, list):
        for item in data:
            yield from _iter_nodes(item)


def _text_of(value) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("value") or "").strip()
    if isinstance(value, list):
        return _text_of(value[0]) if value else ""
    return str(value or "").strip()


def _fill_from_product(prod: Product, node: dict) -> str:
    """Product 노드 값을 빈 칸에만 채운다. 사람이 쓴 값을 덮어쓰지 않는다."""

    def put(key: str, value: str) -> None:
        if value and not str(getattr(prod, key, "") or "").strip():
            setattr(prod, key, value)

    put("name", _text_of(node.get("name")))
    put("description", _text_of(node.get("description")))
    put("image", _text_of(node.get("image")))
    put("brand", _text_of(node.get("brand")))
    put("category", _text_of(node.get("category")))
    put("material", _text_of(node.get("material")))
    put("size", _text_of(node.get("size")))
    put("color", _text_of(node.get("color")))
    put("country", _text_of(node.get("countryOfOrigin")))
    put("manufacturer", _text_of(node.get("manufacturer")))
    put("mpn", _text_of(node.get("mpn")))
    put("gtin13", _text_of(node.get("gtin13")))
    weight = node.get("weight")
    if isinstance(weight, dict):
        unit = "kg" if str(weight.get("unitCode", "")).upper() == "KGM" else "g"
        put("weight", f"{_text_of(weight.get('value'))}{unit}".strip())
    else:
        put("weight", _text_of(weight))
    rating = node.get("aggregateRating")
    if isinstance(rating, dict):
        put("rating_value", _text_of(rating.get("ratingValue")))
        put("review_count", _text_of(rating.get("reviewCount")))
    props = node.get("additionalProperty")
    if isinstance(props, list) and not (prod.extra_props or "").strip():
        lines = []
        for item in props:
            if isinstance(item, dict):
                name, value = _text_of(item.get("name")), _text_of(item.get("value"))
                if name and value:
                    lines.append(f"{name}={value}")
        if lines:
            prod.extra_props = "\n".join(lines)
    offers = node.get("offers")
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    schema_price = ""
    if isinstance(offers, dict):
        schema_price = re.sub(r"[^0-9]", "", _text_of(offers.get("price")))
        put("price", schema_price)
        put("seller", _text_of(offers.get("seller")))
        put("price_valid_until", _text_of(offers.get("priceValidUntil")))
        avail = _text_of(offers.get("availability"))
        if avail.startswith("http"):
            prod.availability = avail
    put("goods_no", str(_text_of(node.get("sku")) or ""))
    return schema_price


def _pick_info(soup: BeautifulSoup, labels: tuple[str, ...]) -> str:
    """상품 정보 목록에서 dt 라벨에 해당하는 dd 값을 찾는다(제조사·원산지 등)."""
    for dl in soup.select("div.item_detail_list dl, dl"):
        dt = dl.find("dt")
        if dt and _text(dt) in labels:
            value = _text(dl.find("dd"))
            if value:
                return value.removeprefix("(주)").strip()
    return ""


def _pick_list_price(soup: BeautifulSoup) -> str:
    for dl in soup.select("div.item_detail_list dl, dl"):
        dt = dl.find("dt")
        if dt and _text(dt) in ("정가", "소비자가", "시중가"):
            dd = dl.find("dd")
            value = _digits(_text(dd.find("del") if dd and dd.find("del") else dd))
            if value:
                return value
    return ""


def _pick_image(soup: BeautifulSoup, page_url: str) -> str:
    meta = soup.find("meta", property="og:image")
    if meta and (meta.get("content") or "").strip():
        return urllib.parse.urljoin(page_url, meta["content"].strip())
    for sel in (
        "div.detail_cont img",
        "div.detail_explain_box img",
        "div.item_photo_big img",
        "img",
    ):
        for img in soup.select(sel):
            src = img.get("src") or img.get("data-src") or ""
            if src and not src.startswith("data:"):
                return urllib.parse.urljoin(page_url, src)
    return ""


def _pick_availability(soup: BeautifulSoup, raw: str) -> str:
    # 품절이면 구매 영역이 재입고 알림 버튼으로 바뀐다(실측 goodsNo 10·16).
    # ENP_VAR.soldOut 은 goodsNo=16 에서 N 으로 나와 믿을 수 없으므로 이것을 먼저 본다.
    if "btn_add_soldout" in raw or "btn_restock_box" in raw:
        return OUT_OF_STOCK
    for m in re.finditer(r"ENP_VAR\.soldOut\s*=\s*'([YyNn])'", raw):
        head = raw[max(0, m.start() - 60) : m.start()]
        if "<!--{" in head:
            continue
        return OUT_OF_STOCK if m.group(1).lower() == "y" else IN_STOCK
    for sel in (
        "div.item_detail_list .soldout",
        ".item_soldout",
        ".goods_soldout",
        "div.item_detail_tit .soldout",
    ):
        if soup.select_one(sel):
            return OUT_OF_STOCK
    buy = soup.select_one("div.item_detail_list, div.item_btn_box")
    if buy and re.search(r"일시품절|품절되었|SOLD\s*OUT", _text(buy), re.I):
        return OUT_OF_STOCK
    return IN_STOCK


def _collect_prices(data) -> list[str]:
    out: list[str] = []
    if isinstance(data, dict):
        for key, value in data.items():
            if key == "price" and isinstance(value, (str, int, float)):
                digits = _digits(str(value))
                if digits:
                    out.append(digits)
            else:
                out.extend(_collect_prices(value))
    elif isinstance(data, list):
        for item in data:
            out.extend(_collect_prices(item))
    return out
