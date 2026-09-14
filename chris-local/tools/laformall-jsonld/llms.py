"""llms.txt 만들기.

AI 크롤러에게 사이트 구조를 알려 주는 파일 규격이다. 라포르몰은 2026-09-14 기준
404 다. 실측 효과가 확인되지 않은 부가 항목이므로 사이트맵 다음에 여력이 있을 때 쓴다.
"""

from __future__ import annotations

import re

import sitemap

TITLE = "라포르몰"
SUMMARY = "진바이오테크의 기능성 베개·마사지기 쇼핑몰"

PAGE_NAMES = {
    "guide.php": "이용안내",
    "agreement.php": "이용약관",
    "private.php": "개인정보처리방침",
    "notice.php": "공지사항",
    "qa.php": "상품문의",
    "faq.php": "자주 묻는 질문",
    "recommand.html": "제품 추천받기",
    "company.php": "회사소개",
    "story.html": "라포르 스토리",
    "campaign.html": "바른자세 캠페인",
    "patent.html": "특허 및 인증안내",
}


def page_name(url: str) -> str:
    tail = url.rstrip("/").split("/")[-1]
    for key, label in PAGE_NAMES.items():
        if key in tail:
            return label
    return tail or url


def build(rows, domain: str, old_xml: str = "", summary: str = SUMMARY) -> str:
    base = (domain or "https://cstpillow.com").rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    lines = [f"# {TITLE}", "", f"> {summary}", "", "## 상품", ""]
    for row in rows:
        if getattr(row, "exposed", "") == "미노출" or getattr(row, "error", ""):
            continue
        name = (row.name or f"goodsNo {row.goods_no}").strip()
        url = row.url or f"{base}/goods/goods_view.php?goodsNo={row.goods_no}"
        note = re.sub(r"\s+", " ", (row.description or "").strip())
        if len(note) > 140:
            note = note[:137].rstrip() + "..."
        lines.append(f"- [{name}]({url})" + (f": {note}" if note else ""))
    static = [url for url, _p, _f in sitemap.carried_over(old_xml, base)] if old_xml else []
    if static:
        lines += ["", "## 안내", ""]
        for url in static:
            lines.append(f"- [{page_name(url)}]({url})")
    lines += [
        "",
        "## 참고",
        "",
        f"- 홈: {base}/",
        "- 판매가와 재고는 상품 페이지의 표시를 따릅니다.",
        "",
    ]
    return "\n".join(lines)
