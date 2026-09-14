"""sitemap.xml 만들기와 기존 사이트맵과의 차이 비교.

고도몰5 는 사이트맵을 자동으로 갱신하지 않는다(라포르몰 파일은 2020-05 생성 후 방치).
그래서 지금 노출 중인 상품으로 표준 사이트맵 프로토콜 XML 을 만들어 준다.
"""

from __future__ import annotations

import re
from datetime import date
from html import unescape
from xml.sax.saxutils import escape

import fetcher

# 사이트맵에 넣지 않는 주소
EXCLUDE = (
    "login.php",
    "member",
    "mypage",
    "cart.php",
    "order",
    "goods_search.php",
    "wish",
    "logout",
    "join",
    "find_",
    "board_password",
    "blank.php",
    "main/index.php",  # 메인과 같은 페이지라 중복
)
# 파라미터 판정은 query_ok 가 한다.

HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
FOOTER = "</urlset>"


def query_ok(query: str) -> bool:
    """쓸 만한 파라미터 URL 인지 본다.

    내용이 있는 페이지(`html.php?htmid=...`, `board/list.php?bdId=event`,
    `faq.php?category=...`)는 남기고, 페이지네이션과 값이 빈 검색 파라미터
    (`faq.php?noheader=&searchWord=`)는 버린다.
    """
    if not query:
        return True
    for pair in query.split("&"):
        if not pair:
            continue
        key, _, value = pair.partition("=")
        key = key.strip().lower()
        if not key:
            return False
        if key in ("page", "sort", "order", "filter") or key.startswith(("utm_", "fbclid", "gclid")):
            return False
        if not value.strip():
            return False
    return True


def is_allowed(url: str) -> bool:
    low = url.lower()
    if any(token in low for token in EXCLUDE):
        return False
    if "?" in low and not query_ok(low.split("?", 1)[1]):
        return False
    return True


def entry(url: str, lastmod: str, priority: str, changefreq: str) -> str:
    return (
        "  <url>\n"
        f"    <loc>{escape(url)}</loc>\n"
        f"    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>{changefreq}</changefreq>\n"
        f"    <priority>{priority}</priority>\n"
        "  </url>"
    )


def collect_urls(rows, domain: str, categories: list[str] | None = None) -> list[tuple[str, str, str]]:
    """(URL, 우선순위, 변경빈도) 목록. 노출 상태인 상품만 넣는다."""
    base = (domain or "https://cstpillow.com").rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    out: list[tuple[str, str, str]] = [(base + "/", "1.0", "weekly")]
    for code in categories or []:
        out.append((f"{base}/goods/goods_list.php?cateCd={code}", "0.7", "weekly"))
    for row in rows:
        if getattr(row, "exposed", "") == "미노출":
            continue
        if getattr(row, "page_state", "") == "접근 불가" or getattr(row, "error", ""):
            continue
        if not getattr(row, "goods_no", ""):
            continue
        out.append((fetcher.product_url(row.goods_no, base), "0.9", "weekly"))
    seen: set[str] = set()
    kept: list[tuple[str, str, str]] = []
    for url, priority, freq in out:
        if url in seen or not is_allowed(url):
            continue
        seen.add(url)
        kept.append((url, priority, freq))
    return kept


def carried_over(old_xml: str, domain: str) -> list[tuple[str, str, str]]:
    """기존 사이트맵의 정적 페이지(브랜드 소개·게시판 등)를 살려 온다.

    옛 파일은 주소가 http·비www 이고 login.php 나 추적 파라미터 URL 도 섞여 있다.
    상품 페이지는 표에서 새로 만들므로 여기서는 뺀다.
    """
    base = (domain or "https://cstpillow.com").rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    out: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for loc in parse_urls(old_xml):
        loc = unescape(loc.strip())
        path = re.sub(r"^https?://[^/]+", "", loc)
        if not path or path == "/":
            continue
        if "goods_view.php" in path:
            continue
        if "?" in path and not query_ok(path.split("?", 1)[1]):
            continue
        url = base + path
        if not is_allowed(url) or url in seen:
            continue
        seen.add(url)
        out.append((url, "0.5", "monthly"))
    return out


def build(
    rows,
    domain: str,
    categories: list[str] | None = None,
    today: str = "",
    old_xml: str = "",
) -> tuple[str, list[str], int]:
    """(XML 문자열, URL 목록, 기존에서 살려 온 URL 수) 를 낸다."""
    lastmod = today or date.today().isoformat()
    urls = collect_urls(rows, domain, categories)
    kept = 0
    if old_xml:
        known = {url for url, _p, _f in urls}
        for item in carried_over(old_xml, domain):
            if item[0] not in known:
                urls.append(item)
                known.add(item[0])
                kept += 1
    body = "\n".join(entry(url, lastmod, priority, freq) for url, priority, freq in urls)
    return f"{HEADER}\n{body}\n{FOOTER}\n", [url for url, _p, _f in urls], kept


def parse_urls(xml_text: str) -> list[str]:
    return re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml_text or "")


def normalize(url: str) -> str:
    """비교용으로 www·프로토콜 차이를 없앤다(사이트맵의 옛 주소는 http·비www 다)."""
    out = re.sub(r"^https?://", "", url.strip())
    out = re.sub(r"^www\.", "", out)
    return out.rstrip("/")


def diff(new_urls: list[str], old_xml: str) -> tuple[list[str], list[str]]:
    """(추가된 URL, 빠진 URL). 주소 표기 차이는 무시하고 내용으로 비교한다."""
    old_urls = parse_urls(old_xml)
    old_map = {normalize(u): u for u in old_urls}
    new_map = {normalize(u): u for u in new_urls}
    added = [new_map[k] for k in new_map if k not in old_map]
    removed = [old_map[k] for k in old_map if k not in new_map]
    added.sort()
    removed.sort()
    return added, removed


def robots_line(domain: str) -> str:
    base = (domain or "https://cstpillow.com").rstrip("/")
    return f"Sitemap: {base}/sitemap.xml"
