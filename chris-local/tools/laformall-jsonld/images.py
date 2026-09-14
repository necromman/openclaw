"""대표 이미지 후보 찾기·크기 측정·썸네일 고르기 창.

고도몰은 상품 이미지를 자체 CDN(godomall.speedycdn.net)에 둔다. 그래서 이미지
주소가 cstpillow.com 이 아니라 그 CDN 주소로 나오는 것이 정상이다. 구글은 그
주소가 열리는지만 본다.

상품 페이지에는 관련 상품의 대표 이미지도 섞여 있으므로 `/goods/<goodsNo>/image/`
경로인 것만 이 상품의 후보로 본다(실측: goodsNo=11 페이지에 goods/14 이미지가 있다).
"""

from __future__ import annotations

import io
import re

IMAGE_RE = re.compile(
    r"https?://[^\"'\s)]+?/goods/(\d+)/image/([a-z0-9_]+)/[^\"'\s)]+?\.(?:jpg|jpeg|png|gif|webp)",
    re.I,
)
KIND_LABEL = {
    "main": "대표",
    "list": "목록",
    "magnify": "확대",
    "detail": "상세",
    "add1": "추가1",
    "add2": "추가2",
    "add3": "추가3",
}
KIND_ORDER = ["main", "list", "magnify", "detail"]

GOOGLE_MIN = (160, 90)
GOOGLE_RECOMMEND_WIDTH = 1200

_sizes: dict[str, tuple[int, int]] = {}
_thumbs: dict[str, object] = {}


def kind_label(kind: str) -> str:
    return KIND_LABEL.get(kind.lower(), kind)


def candidates(raw: str, page_url: str, goods_no: str, og_image: str = "") -> list[dict]:
    """이 상품의 이미지 후보를 낸다. [{url, kind, label}] 형태로 대표·목록·확대·상세 순."""
    found: list[dict] = []
    seen: set[str] = set()

    def add(url: str, kind: str) -> None:
        if not url or url in seen:
            return
        seen.add(url)
        found.append({"url": url, "kind": kind, "label": kind_label(kind)})

    for match in IMAGE_RE.finditer(raw or ""):
        if match.group(1) != str(goods_no):
            continue  # 관련 상품 이미지
        add(match.group(0), match.group(2).lower())
    if og_image:
        add(og_image, "og")
    order = {kind: index for index, kind in enumerate(KIND_ORDER)}
    found.sort(key=lambda item: (order.get(item["kind"], 9), item["url"]))
    return found


def default_image(cands: list[dict], og_image: str = "") -> str:
    """자동으로 넣을 기본값. 대표(main)·목록(list) 이미지를 먼저 쓰고 없으면 og:image."""
    for kind in ("main", "list"):
        for item in cands:
            if item["kind"] == kind:
                return item["url"]
    if og_image:
        return og_image
    return cands[0]["url"] if cands else ""


def measure(url: str, session=None) -> tuple[int, int] | None:
    """이미지를 받아 가로x세로를 잰다. HEAD 로는 크기를 알 수 없어서 내려받는다."""
    if not url:
        return None
    if url in _sizes:
        return _sizes[url]
    try:
        from PIL import Image

        data = _download(url, session)
        size = Image.open(io.BytesIO(data)).size
        _sizes[url] = size
        return size
    except Exception:
        return None


def _download(url: str, session=None) -> bytes:
    if session is not None:
        resp = session.get(url, timeout=25)
        resp.raise_for_status()
        return resp.content
    import urllib.request

    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=25) as resp:
        return resp.read()


def size_warnings(size: tuple[int, int] | None) -> list[str]:
    """구글 이미지 권장 크기 검사. 오류가 아니라 경고로만 낸다."""
    if not size:
        return []
    width, height = size
    out: list[str] = []
    if width < GOOGLE_MIN[0] or height < GOOGLE_MIN[1]:
        out.append(f"대표 이미지가 {width}x{height} 입니다. 구글 최소 크기 160x90 보다 작습니다")
    elif width < GOOGLE_RECOMMEND_WIDTH:
        out.append(
            f"대표 이미지 가로가 {width}px 입니다. 구글은 1200px 이상을 권장합니다"
            " (더 큰 이미지가 있으면 '이미지 고르기' 로 바꾸세요)"
        )
    return out


def thumbnail(url: str, box: int = 130, session=None):
    """tkinter 에 올릴 썸네일을 만든다. 참조를 잃으면 사라지므로 캐시에 둔다."""
    key = f"{url}|{box}"
    if key in _thumbs:
        return _thumbs[key]
    from PIL import Image, ImageTk

    data = _download(url, session)
    image = Image.open(io.BytesIO(data))
    _sizes[url] = image.size
    image = image.convert("RGB")
    image.thumbnail((box, box))
    photo = ImageTk.PhotoImage(image)
    _thumbs[key] = photo
    return photo


def known_size(url: str) -> tuple[int, int] | None:
    return _sizes.get(url)


# ---------------------------------------------------------------------- 고르기 창


def pick_dialog(app, prod, on_pick) -> None:
    """이미지 후보를 썸네일 격자로 보여 주고 고르면 on_pick(url) 을 부른다."""
    tk, ttk = app.tk, app.ttk
    cands = list(getattr(prod, "image_candidates", []) or [])
    if not cands:
        app.warn(
            "이미지 고르기",
            "이 상품에서 찾은 이미지가 없습니다. 먼저 '가져오기' 를 눌러 상품을 수집하세요.",
        )
        return
    win = tk.Toplevel(app.root)
    win.title(f"대표 이미지 고르기 - goodsNo={prod.goods_no} {prod.name}")
    win.geometry("900x640")
    tk.Label(
        win,
        text=(
            "상품의 대표 사진 한 장을 고릅니다. 주소가 godomall.speedycdn.net 인 것은 "
            "고도몰이 이미지를 자체 서버에 두기 때문이고 정상입니다.\n"
            "가로 1200px 이상이면 가장 좋습니다. 크기는 아래에 함께 적었습니다."
        ),
        justify="left",
        fg="#404040",
        wraplength=860,
    ).pack(anchor="w", padx=10, pady=8)
    canvas = tk.Canvas(win, highlightthickness=0)
    bar = ttk.Scrollbar(win, orient="vertical", command=canvas.yview)
    canvas.configure(yscrollcommand=bar.set)
    canvas.pack(side="left", fill="both", expand=True, padx=(10, 0), pady=6)
    bar.pack(side="left", fill="y", pady=6)
    grid = ttk.Frame(canvas)
    canvas.create_window((0, 0), window=grid, anchor="nw")
    grid.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))

    def choose(url: str) -> None:
        on_pick(url)
        win.destroy()

    session = getattr(app, "image_session", None)
    columns = 5
    for index, item in enumerate(cands):
        cell = ttk.Frame(grid)
        cell.grid(row=index // columns, column=index % columns, padx=6, pady=6, sticky="n")
        try:
            photo = thumbnail(item["url"], 130, session)
            button = tk.Button(cell, image=photo, command=lambda u=item["url"]: choose(u))
            button.image = photo
        except Exception as exc:
            button = tk.Button(
                cell, text=f"미리보기 실패\n{str(exc)[:30]}", width=18, height=7,
                command=lambda u=item["url"]: choose(u),
            )
        button.pack()
        size = known_size(item["url"])
        detail = f"{size[0]}x{size[1]}" if size else "크기 미확인"
        tk.Label(cell, text=f"{item['label']} / {detail}", font=("Segoe UI", 8)).pack()
        tk.Label(
            cell, text=item["url"].split("/")[-1][:22], font=("Segoe UI", 7), fg="#707070"
        ).pack()
    ttk.Button(win, text="닫기", command=win.destroy).pack(side="bottom", pady=6)
