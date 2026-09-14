"""구글 리치 결과 테스트 자동 실행과 프로그램 안에서 여는 창.

PC 에 설치된 Edge(없으면 Chrome)를 DevTools 프로토콜로 제어한다(browser.py).
파이썬이 없는 PC 에서도 이 실행 파일 하나로 동작한다.

최종 판정은 이 도구의 결과다. validator 의 로컬 판정은 참고용이다.
"""

from __future__ import annotations

import re
import time
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime

import browser

TEST_URL = "https://search.google.com/test/rich-results?url="
TIMEOUT_SEC = 90
POLL_SEC = 3
DONE_TOKENS = ("유효한 항목", "감지된 구조화 데이터", "항목 없음")
BLOCK_TOKENS = ("로그인한 후 다시", "문제 발생")

STATUS_VALID = "유효"
STATUS_WARN = "경고 있음"
STATUS_ERROR = "오류"
STATUS_NONE = "미감지"
STATUS_MANUAL = "수동 확인 필요"
STATUS_SKIP = "미실행"

COLOR = {
    STATUS_VALID: "#e2f4e2",
    STATUS_WARN: "#fff4d0",
    STATUS_ERROR: "#ffe0e0",
    STATUS_NONE: "#ffe0e0",
    STATUS_MANUAL: "#e6e6ff",
    STATUS_SKIP: "#eeeeee",
}
FOREGROUND = {
    STATUS_VALID: "#105010",
    STATUS_WARN: "#8a5a00",
    STATUS_ERROR: "#a00000",
    STATUS_NONE: "#a00000",
    STATUS_MANUAL: "#303090",
    STATUS_SKIP: "#606060",
}


def test_url(url: str) -> str:
    return TEST_URL + urllib.parse.quote(url, safe="")


@dataclass
class GoogleResult:
    goods_no: str = ""
    url: str = ""
    status: str = STATUS_SKIP
    valid_count: int = 0
    items: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    at: str = ""
    text: str = ""
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "goods_no": self.goods_no,
            "url": self.url,
            "status": self.status,
            "valid_count": self.valid_count,
            "items": list(self.items),
            "warnings": list(self.warnings),
            "at": self.at,
            "note": self.note,
            "text": self.text,
        }

    def summary(self) -> str:
        head = self.status
        if self.valid_count:
            head += f" (유효한 항목 {self.valid_count}개)"
        if self.items:
            head += " / " + ", ".join(self.items)
        return head


def available() -> tuple[bool, str]:
    """구글 자동 테스트를 할 수 있는지. 설치된 Edge 나 Chrome 만 있으면 된다."""
    return (True, "") if browser.find_browser() else (False, browser.NO_BROWSER)


def browser_label() -> str:
    found = browser.find_browser()
    return found[1] if found else "없음"


def parse_body(text: str) -> tuple[str, int, list[str], list[str], str]:
    """결과 텍스트에서 (상태, 유효 항목 수, 감지 항목, 경고, 비고) 를 뽑는다."""
    if not text:
        return STATUS_MANUAL, 0, [], [], "결과 텍스트를 읽지 못했습니다"
    if any(token in text for token in BLOCK_TOKENS):
        return STATUS_MANUAL, 0, [], [], "구글이 로그인을 요구했습니다"
    if "확인할 수 없음" in text or "페이지를 가져올 수 없" in text:
        return STATUS_ERROR, 0, [], [], "구글이 페이지를 가져오지 못했습니다"
    count = 0
    match = re.search(r"유효한 항목\s*(\d+)\s*개", text)
    if match:
        count = int(match.group(1))
    items: list[str] = []
    block = text.split("감지된 구조화 데이터", 1)
    if len(block) > 1:
        for line in block[1].splitlines():
            # 아이콘 글꼴(사용자 영역 문자)을 지운다.
            line = re.sub(r"[-]", "", line).strip()
            if not line or line in ("check_circle", "warning", "error", "추가 자료"):
                continue
            if line.startswith("유효한 항목") or line.startswith("심각하지 않은"):
                continue
            if line.startswith("추가 자료") or line.startswith("사이트 전체"):
                break
            if line.startswith("항목") or "개 감지" in line:
                continue
            if 1 < len(line) < 40 and line not in items:
                items.append(line)
            if len(items) >= 8:
                break
    warnings: list[str] = []
    if "심각하지 않은 문제" in text:
        warnings.append("심각하지 않은 문제가 감지됨")
    for pattern in (r"(유효하지 않은 항목\s*\d+\s*개)", r"(오류\s*\d+\s*개)", r"(항목 파싱 오류)"):
        found = re.search(pattern, text)
        if found:
            warnings.append(found.group(1))
    if "유효하지 않은 항목" in text or "파싱 오류" in text:
        status = STATUS_ERROR
    elif count > 0:
        status = STATUS_WARN if warnings else STATUS_VALID
    elif "감지된 항목 없음" in text or "구조화된 데이터를 찾을 수 없" in text or "항목 없음" in text:
        status = STATUS_NONE
    else:
        status = STATUS_MANUAL
    return status, count, items, warnings, ""


def _read_result(session: browser.Browser) -> str:
    """결과가 나올 때까지 본문 텍스트를 되풀이해 읽는다."""
    deadline = time.time() + TIMEOUT_SEC
    body = ""
    while time.time() < deadline:
        time.sleep(POLL_SEC)
        try:
            body = session.body_text()
        except Exception:
            continue
        if any(token in body for token in DONE_TOKENS + BLOCK_TOKENS):
            return body
    return body


def run_one(goods_no: str, url: str) -> GoogleResult:
    result = GoogleResult(goods_no=str(goods_no), url=url)
    result.at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ok, note = available()
    if not ok:
        result.status = STATUS_MANUAL
        result.note = note
        return result
    body = ""
    try:
        with browser.Browser(offscreen=True) as session:
            session.connect()
            session.navigate(test_url(url))
            body = _read_result(session)
    except Exception as exc:
        result.status = STATUS_MANUAL
        result.note = str(exc)
        return result
    status, count, items, warns, note = parse_body(body)
    result.status = status
    result.valid_count = count
    result.items = items
    result.warnings = warns
    result.note = note
    result.text = body[:4000]
    result.at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return result


def run_many(pairs: list[tuple[str, str]], progress=None) -> list[GoogleResult]:
    """[(goodsNo, url)] 을 순차 실행한다. 한 건이 막혀도 멈추지 않는다."""
    out: list[GoogleResult] = []
    total = len(pairs)
    for index, (goods_no, url) in enumerate(pairs, 1):
        if progress:
            progress(index, total, goods_no)
        try:
            out.append(run_one(goods_no, url))
        except Exception as exc:
            item = GoogleResult(goods_no=str(goods_no), url=url, status=STATUS_MANUAL)
            item.note = str(exc)
            item.at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            out.append(item)
    return out


def open_embedded(url: str, title: str = "구글 리치 결과 테스트") -> tuple[bool, str]:
    """프로그램 안에서 창을 띄워 리치 결과 테스트 페이지를 연다.

    먼저 pywebview(Edge WebView2)로 자체 창을 띄우고, WebView2 런타임이 없으면
    설치된 Edge·Chrome 창을 화면 안에 띄운다. 어느 쪽도 파이썬을 부르지 않는다.
    """
    target = test_url(url)
    note = ""
    try:
        import webview

        webview.create_window(title, target, width=1180, height=900)
        webview.start()
        return True, "내장 창"
    except Exception as exc:
        note = str(exc)
    ok, label = browser.open_window(target)
    if ok:
        return True, f"{label} 창(내장 창을 쓸 수 없어 대신 띄웠습니다: {note})"
    return False, f"창을 열지 못했습니다: {note} / {label}"
