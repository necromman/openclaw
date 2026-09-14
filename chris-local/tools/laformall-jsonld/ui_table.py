"""상품 목록 표. 열 이름과 색이 무슨 뜻인지 헷갈리지 않게 만든다.

행 색은 "페이지 적용"(실제 상품 페이지에 정보표가 붙어 있는지)을 따른다.
프로그램 안 폼의 입력 상태는 "입력 상태" 열 글자색으로만 보여 준다.
"""

from __future__ import annotations

import fields
import google_test
import validator

COLUMNS = [
    ("goods_no", "goodsNo", 70),
    ("name", "상품명", 200),
    ("price", "판매가", 84),
    ("exposed", "노출", 78),
    ("input", "입력 상태", 150),
    ("applied", "페이지 적용", 130),
    ("google", "구글 테스트", 140),
]

# 페이지 적용 상태별 행 색
APPLIED_BG = {
    "적용됨(가격 일치)": "#e2f4e2",
    "적용됨(가격 불일치)": "#ffe0e0",
    "미적용": "#f0f0f0",
    "미확인": "#eef0f6",
    "확인 실패": "#eef0f6",
}
APPLIED_FG = {
    "적용됨(가격 일치)": "#105010",
    "적용됨(가격 불일치)": "#a00000",
    "미적용": "#505050",
    "미확인": "#404060",
    "확인 실패": "#404060",
}
LEGEND = (
    "행 색 = 페이지 적용 상태(초록 적용됨, 빨강 가격 불일치, 회색 미적용). "
    "입력 상태는 이 프로그램 폼에 값이 얼마나 찼는지입니다. 셀에 마우스를 올리면 자세히 나옵니다."
)


def build(app, parent) -> None:
    tk, ttk = app.tk, app.ttk
    box = ttk.Labelframe(parent, text=" 상품 목록 ", padding=4)
    box.pack(fill="x", padx=4, pady=4)
    tk.Label(
        box, text=LEGEND, fg="#5a5a5a", font=("맑은 고딕", 9), justify="left", wraplength=740
    ).pack(anchor="w", pady=(0, 4))
    holder = ttk.Frame(box)
    holder.pack(fill="x")
    app.tree = ttk.Treeview(
        holder, columns=[c[0] for c in COLUMNS], show="headings", selectmode="extended", height=11
    )
    for key, label, width in COLUMNS:
        app.tree.heading(key, text=label)
        app.tree.column(key, width=width, anchor="w")
    vsb = ttk.Scrollbar(holder, orient="vertical", command=app.tree.yview)
    app.tree.configure(yscrollcommand=vsb.set)
    app.tree.pack(side="left", fill="x", expand=True)
    vsb.pack(side="left", fill="y")
    app.tree.bind("<<TreeviewSelect>>", app.on_pick_row)
    app.tree.bind("<Double-1>", app.on_row_detail)
    for state, colour in APPLIED_BG.items():
        app.tree.tag_configure(f"a-{state}", background=colour, foreground=APPLIED_FG[state])
    app.tree.tag_configure("a-", background="#ffffff", foreground="#202020")
    hidden_font = app.tkfont.Font(family="맑은 고딕", size=10, overstrike=1)
    app.tree.tag_configure("hidden", background="#e4e4e4", foreground="#8a8a8a", font=hidden_font)
    _tooltip(app)


def refresh(app, keep: str = "") -> None:
    selection = keep or (list(app.tree.selection()) or [""])[0]
    app.tree.delete(*app.tree.get_children())
    for row in app.rows:
        verdict = app.verdicts.get(row.goods_no)
        google = app.google.get(row.goods_no)
        price = f"{int(row.price):,}" if str(row.price).isdigit() else row.price
        exposed = row.exposed or ""
        if row.sale_state == "품절" or row.availability == fields.OUT_OF_STOCK:
            exposed = (exposed + " 품절").strip()
        tags = [f"a-{row.applied}" if row.applied in APPLIED_BG else "a-"]
        if row.exposed == "미노출":
            tags.insert(0, "hidden")
        app.tree.insert(
            "",
            "end",
            iid=row.goods_no,
            values=(
                row.goods_no,
                row.name,
                price,
                exposed,
                verdict.summary() if verdict else "확인 전",
                row.applied or ("페이지 없음" if row.error else "미확인"),
                app.google_stage.get(row.goods_no)
                if getattr(app, "google_stage", None) and row.goods_no in app.google_stage
                else (google.summary() if google else ""),
            ),
            tags=tuple(tags),
        )
    if selection and app.tree.exists(selection):
        app.tree.selection_set(selection)


def cell_text(app, goods_no: str, column: str) -> str:
    row = app.find_row(goods_no)
    if not row:
        return ""
    if column == "input":
        verdict = app.verdicts.get(goods_no)
        return verdict.tooltip() if verdict else "아직 판정하지 않았습니다"
    if column == "applied":
        return (row.applied_detail or row.applied or "확인하지 않았습니다") + (
            "\n페이지에 이미 있던 정보표를 읽어 폼을 채웠습니다." if row.filled_from_page else ""
        )
    if column == "google":
        result = app.google.get(goods_no)
        if not result:
            return "구글 테스트를 아직 돌리지 않았습니다"
        lines = [result.summary()]
        if result.warnings:
            lines.append("경고: " + ", ".join(result.warnings))
        if result.note:
            lines.append(result.note)
        return "\n".join(lines)
    if column == "exposed":
        return f"노출 상태: {row.exposed or '미확인'} / 판매 상태: {row.sale_state or '미확인'}"
    return ""


def _tooltip(app) -> None:
    """셀에 마우스를 올리면 자세한 내용을 띄운다."""
    tk = app.tk
    state = {"window": None, "key": None}

    def hide(_event=None):
        if state["window"] is not None:
            state["window"].destroy()
            state["window"] = None
            state["key"] = None

    def show(event):
        row_id = app.tree.identify_row(event.y)
        col_id = app.tree.identify_column(event.x)
        if not row_id or not col_id:
            hide()
            return
        try:
            index = int(col_id.replace("#", "")) - 1
            column = COLUMNS[index][0]
        except Exception:
            hide()
            return
        if column not in ("input", "applied", "google", "exposed"):
            hide()
            return
        key = (row_id, column)
        if state["key"] == key:
            return
        hide()
        text = cell_text(app, row_id, column)
        if not text:
            return
        window = tk.Toplevel(app.tree)
        window.wm_overrideredirect(True)
        window.wm_geometry(f"+{event.x_root + 14}+{event.y_root + 14}")
        tk.Label(
            window,
            text=text,
            justify="left",
            background="#ffffe0",
            relief="solid",
            borderwidth=1,
            font=("맑은 고딕", 9),
            padx=6,
            pady=4,
        ).pack()
        state["window"] = window
        state["key"] = key

    app.tree.bind("<Motion>", show, add="+")
    app.tree.bind("<Leave>", hide, add="+")
