"""이력·설정·도움말 탭. app.App 인스턴스를 받아 위젯을 붙인다."""

from __future__ import annotations

import os
import urllib.parse
import webbrowser
from pathlib import Path

import fetcher
import form as form_mod
import google_test
import history
import schema
import settings
import validator

HIST_COLUMNS = [
    ("at", "시각", 130),
    ("goods_no", "goodsNo", 66),
    ("name", "상품명", 200),
    ("price", "판매가", 80),
    ("local", "로컬 판정", 80),
    ("google", "구글 결과", 150),
    ("hash", "해시", 110),
    ("result", "검증", 80),
    ("saved_path", "저장 파일", 200),
]

def build_history_tab(app, frame) -> None:
    ttk = app.ttk
    tk = app.tk
    top = ttk.Frame(frame)
    top.pack(fill="x", padx=6, pady=6)
    for text, cmd in [
        ("새로 읽기", lambda: reload_history(app)),
        ("스니펫 보기", lambda: _show(app)),
        ("복사", lambda: _copy(app)),
        ("재생성", lambda: _regen(app)),
        ("선택 삭제", lambda: _delete(app)),
        ("전체 비우기", lambda: _clear(app)),
        ("가격 변동 보기", lambda: _trend(app)),
        ("구글 결과 보기", lambda: _google_detail(app)),
        ("CSV 내보내기", lambda: _export(app)),
        ("이력 폴더 열기", lambda: _open_dir(app)),
    ]:
        ttk.Button(top, text=text, command=cmd).pack(side="left", padx=2)

    app.hist_tree = ttk.Treeview(
        frame, columns=[c[0] for c in HIST_COLUMNS], show="headings", selectmode="extended"
    )
    for key, label, width in HIST_COLUMNS:
        app.hist_tree.heading(key, text=label)
        app.hist_tree.column(key, width=width, anchor="w")
    vsb = ttk.Scrollbar(frame, orient="vertical", command=app.hist_tree.yview)
    app.hist_tree.configure(yscrollcommand=vsb.set)
    app.hist_tree.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
    vsb.pack(side="left", fill="y", pady=6)
    for status, colour in validator.COLOR.items():
        app.hist_tree.tag_configure(
            f"v-{status}", background=colour, foreground=validator.FOREGROUND[status]
        )
    app.hist_view = tk.Text(frame, height=14, width=64, wrap="none")
    app.hist_view.pack(side="left", fill="both", expand=True, padx=6, pady=6)
    app.hist_records = []
    reload_history(app)


def reload_history(app) -> None:
    if not hasattr(app, "hist_tree"):
        return
    app.hist_records = history.load()
    app.hist_tree.delete(*app.hist_tree.get_children())
    for idx, rec in enumerate(reversed(app.hist_records)):
        real = len(app.hist_records) - 1 - idx
        price = rec.get("price", "")
        google = history.latest_google(rec.get("goods_no", "")) or {}
        google_text = ""
        if google:
            google_text = f"{google.get('status', '')} ({google.get('at', '')[5:16]})"
        local = rec.get("local_status", "") or validator.STATUS_NONE
        app.hist_tree.insert(
            "",
            "end",
            iid=str(real),
            values=(
                rec.get("at", ""),
                rec.get("goods_no", ""),
                rec.get("name", ""),
                f"{int(price):,}" if str(price).isdigit() else price,
                local,
                google_text,
                rec.get("hash", ""),
                rec.get("result", ""),
                rec.get("saved_path", ""),
            ),
            tags=(f"v-{local}" if local in validator.COLOR else f"v-{validator.STATUS_NONE}",),
        )
    app.log(f"이력 {len(app.hist_records)}건")


def _picked(app) -> list[dict]:
    keys = list(app.hist_tree.selection())
    return [app.hist_records[int(k)] for k in keys if int(k) < len(app.hist_records)]


def _show(app) -> None:
    recs = _picked(app)
    if not recs:
        app.warn("이력", "목록에서 항목을 선택하세요.")
        return
    rec = recs[0]
    body = [
        f"시각: {rec.get('at')}",
        f"goodsNo: {rec.get('goods_no')}",
        f"상품명: {rec.get('name')}",
        f"판매가: {rec.get('price')}  정가: {rec.get('list_price')}",
        f"URL: {rec.get('url')}",
        f"해시: {rec.get('hash')}",
        f"검증: {rec.get('result')}",
        f"저장 파일: {rec.get('saved_path') or '(없음)'}",
        f"가격 변동: {history.price_change_label(rec.get('goods_no'), rec.get('price'))}",
        f"로컬 판정: {rec.get('local_status') or '기록 없음'}",
    ]
    if rec.get("local_missing"):
        body.append("부족 항목: " + ", ".join(rec["local_missing"]))
    google = history.latest_google(rec.get("goods_no", ""))
    if google:
        body.append(
            f"구글 테스트({google.get('at')}): {google.get('status')} "
            f"유효한 항목 {google.get('valid_count')}개 "
            + (", ".join(google.get("items") or []))
        )
        if google.get("warnings"):
            body.append("구글 경고: " + ", ".join(google["warnings"]))
        if google.get("note"):
            body.append("비고: " + google["note"])
    else:
        body.append("구글 테스트: 기록 없음 (생성 탭에서 구글 일괄 테스트를 돌리세요)")
    if rec.get("errors"):
        body.append("검증 오류: " + "; ".join(rec["errors"]))
    if rec.get("warnings"):
        body.append("규제 경고: " + "; ".join(rec["warnings"]))
    body.append("")
    body.append(rec.get("snippet", ""))
    app.hist_view.delete("1.0", "end")
    app.hist_view.insert("1.0", "\n".join(body))


def _copy(app) -> None:
    recs = _picked(app)
    if not recs:
        app.warn("이력", "목록에서 항목을 선택하세요.")
        return
    app.clipboard("\n\n".join(r.get("snippet", "") for r in recs))
    app.log(f"이력 {len(recs)}건을 클립보드에 복사했습니다")


def _regen(app) -> None:
    recs = _picked(app)
    if not recs:
        app.warn("이력", "목록에서 항목을 선택하세요.")
        return
    lines = []
    for rec in recs:
        prod = fetcher.Product(
            goods_no=str(rec.get("goods_no", "")),
            url=rec.get("url", ""),
            availability=rec.get("availability", fetcher.IN_STOCK),
            brand=app.cfg["brand"],
            seller=app.cfg["seller"],
            status="이력 재생성",
        )
        for key in fields.BY_KEY:
            if key in ("url", "goods_no", "currency", "availability_label", "faq"):
                continue
            if rec.get(key):
                setattr(prod, key, rec[key])
        prod.faq = [tuple(item) for item in (rec.get("faq") or [])]
        data = schema.build_product(prod)
        text = schema.full_snippet(prod)
        errors = schema.validate(prod, data, None)
        app.snippets[prod.goods_no] = text
        if not app.find_row(prod.goods_no):
            app.rows.append(prod)
        history.add(prod, text, schema.snippet_hash(text), "", errors, [])
        lines.append(f"<!-- goodsNo={prod.goods_no} {prod.name} -->\n{text}")
        if errors:
            lines.append("<!-- 검증 오류: " + "; ".join(errors) + " -->")
    app.refresh_tree()
    app.hist_view.delete("1.0", "end")
    app.hist_view.insert("1.0", "\n\n".join(lines))
    reload_history(app)
    app.log(f"{len(recs)}건을 재생성해 생성 탭 표에 넣었습니다")


def _delete(app) -> None:
    keys = [int(k) for k in app.hist_tree.selection()]
    if not keys:
        app.warn("이력", "목록에서 항목을 선택하세요.")
        return
    if not app.ask("삭제", f"{len(keys)}건을 삭제할까요?"):
        return
    removed = history.delete(keys)
    reload_history(app)
    app.log(f"이력 {removed}건을 삭제했습니다")


def _clear(app) -> None:
    if not app.ask("전체 비우기", "이력을 모두 지울까요? 되돌릴 수 없습니다."):
        return
    count = history.clear()
    reload_history(app)
    app.log(f"이력 {count}건을 지웠습니다")


def _trend(app) -> None:
    recs = _picked(app)
    if not recs:
        app.warn("이력", "목록에서 항목을 선택하세요.")
        return
    goods_no = recs[0].get("goods_no")
    trend = history.price_trend(goods_no)
    lines = [f"goodsNo={goods_no} 가격 기록 {len(trend)}건", ""]
    prev = None
    for at, price in trend:
        mark = ""
        if prev is not None and price.isdigit() and prev.isdigit():
            diff = int(price) - int(prev)
            if diff:
                mark = f"  ({'상승' if diff > 0 else '하락'} {abs(diff):,}원)"
        lines.append(f"{at}  {price}{mark}")
        prev = price
    app.hist_view.delete("1.0", "end")
    app.hist_view.insert("1.0", "\n".join(lines))


def _export(app) -> None:
    recs = app.hist_records
    if not recs:
        app.warn("이력", "이력이 없습니다.")
        return
    payload = []
    for rec in recs:
        item = dict(rec)
        google = history.latest_google(rec.get("goods_no", "")) or {}
        item["google_status"] = google.get("status", "")
        item["google_detail"] = (
            f"유효한 항목 {google.get('valid_count', 0)}개 " + ", ".join(google.get("items") or [])
        ).strip() if google else ""
        payload.append(item)
    path = Path(app.cfg["out_dir"]) / "history-export.csv"
    history.export_csv(payload, path)
    app.info("CSV 내보내기", str(path))
    app.log(f"이력 {len(payload)}건을 CSV 로 내보냈습니다: {path}")


def _google_detail(app) -> None:
    recs = _picked(app)
    if not recs:
        app.warn("이력", "목록에서 항목을 선택하세요.")
        return
    goods_no = recs[0].get("goods_no", "")
    items = [r for r in history.load_google() if str(r.get("goods_no")) == str(goods_no)]
    if not items:
        app.hist_view.delete("1.0", "end")
        app.hist_view.insert("1.0", f"goodsNo={goods_no} 구글 테스트 기록이 없습니다.")
        return
    latest = items[-1]
    lines = [
        f"goodsNo={goods_no} 구글 리치 결과 테스트 기록 {len(items)}건 (최종 판정)",
        "",
        f"최근: {latest.get('at')}  상태: {latest.get('status')}  "
        f"유효한 항목 {latest.get('valid_count')}개",
        "감지 항목: " + ", ".join(latest.get("items") or ["(없음)"]),
        "경고: " + ", ".join(latest.get("warnings") or ["(없음)"]),
        "비고: " + (latest.get("note") or "(없음)"),
        "",
        "이전 기록",
    ]
    for item in items[:-1][-10:]:
        lines.append(f"  {item.get('at')}  {item.get('status')}  유효 {item.get('valid_count')}개")
    lines += ["", "원문", latest.get("text", "")[:2500]]
    app.hist_view.delete("1.0", "end")
    app.hist_view.insert("1.0", "\n".join(lines))


def _open_dir(app) -> None:
    path = settings.data_dir()
    try:
        os.startfile(str(path))
    except Exception:
        webbrowser.open(path.as_uri())


# ---------------------------------------------------------------------- 설정


SETTING_FIELDS = [
    ("brand", "브랜드 기본값", 30),
    ("seller", "판매자 기본값", 30),
    ("domain", "스니펫에 쓰는 도메인", 46),
    ("fetch_domain", "수집에 쓰는 도메인", 46),
    ("sitemap_url", "사이트맵 URL", 60),
    ("user_agent", "User-Agent", 80),
    ("out_dir", "출력 폴더", 60),
    ("timeout", "타임아웃(초)", 8),
    ("retries", "재시도 횟수", 8),
]


def build_settings_tab(app, frame) -> None:
    tk, ttk = app.tk, app.ttk
    box = ttk.LabelFrame(frame, text="설정 (%APPDATA%\\laformall-jsonld\\settings.json)")
    box.pack(fill="x", padx=8, pady=8)
    app.set_vars = {}
    for row, (key, label, width) in enumerate(SETTING_FIELDS):
        ttk.Label(box, text=label).grid(row=row, column=0, sticky="e", padx=(8, 6), pady=3)
        var = tk.StringVar(value=str(app.cfg.get(key, "")))
        ttk.Entry(box, textvariable=var, width=width).grid(row=row, column=1, sticky="w", pady=3)
        app.set_vars[key] = var
    app.set_head = tk.BooleanVar(value=bool(app.cfg.get("check_image_head", True)))
    ttk.Checkbutton(box, text="생성 전 이미지 URL HEAD 200 확인", variable=app.set_head).grid(
        row=len(SETTING_FIELDS), column=1, sticky="w", pady=4
    )
    btns = ttk.Frame(frame)
    btns.pack(fill="x", padx=8)
    ttk.Button(btns, text="저장", command=lambda: _save_settings(app)).pack(side="left")
    ttk.Button(btns, text="기본값으로", command=lambda: _reset_settings(app)).pack(side="left", padx=4)
    ttk.Button(btns, text="출력 폴더 열기", command=app.on_open_out).pack(side="left")
    ttk.Button(btns, text="설정 폴더 열기", command=lambda: _open_dir(app)).pack(side="left", padx=4)
    note = (
        "스니펫 도메인은 실제로 검증한 주소와 같게 둡니다(기본 https://cstpillow.com).\n"
        "수집 도메인은 www 주소를 씁니다. 고도몰은 PC(www)와 모바일(m)이 갈려 있어\n"
        "스니펫 URL 은 한쪽으로 모아야 인용이 흩어지지 않습니다."
    )
    ttk.Label(frame, text=note, justify="left", foreground="#404040").pack(
        anchor="w", padx=10, pady=10
    )


def _save_settings(app) -> None:
    for key, var in app.set_vars.items():
        value = var.get().strip()
        if key in ("timeout", "retries"):
            try:
                app.cfg[key] = int(value)
            except ValueError:
                app.warn("설정", f"{key} 는 숫자여야 합니다.")
                return
        elif value:
            app.cfg[key] = value
    app.cfg["check_image_head"] = bool(app.set_head.get())
    path = settings.save(app.cfg)
    app.cfg = settings.load()
    app.log(f"설정을 저장했습니다: {path}")


def _reset_settings(app) -> None:
    if not app.ask("기본값", "설정을 기본값으로 되돌릴까요?"):
        return
    app.cfg = settings.reset()
    for key, var in app.set_vars.items():
        var.set(str(app.cfg.get(key, "")))
    app.set_head.set(bool(app.cfg.get("check_image_head", True)))
    app.log("설정을 기본값으로 되돌렸습니다")


# ---------------------------------------------------------------------- 도움말


def rich_results_url(url: str) -> str:
    return "https://search.google.com/test/rich-results?url=" + urllib.parse.quote(url, safe="")


# ---------------------------------------------------------------------- 생성 탭 조각


def build_form_panel(app, parent) -> None:
    ttk = app.ttk
    box = ttk.LabelFrame(parent, text="4. 상품 편집 (별표는 필수, 회색 글씨는 예시)")
    box.pack(fill="both", expand=True, padx=4, pady=4)
    bar = ttk.Frame(box)
    bar.pack(fill="x", padx=6, pady=4)
    for text, cmd in (
        ("예시로 채우기", app.on_fill_example),
        ("폼 비우기", app.on_clear_form),
        ("설명 초안", app.on_draft),
        ("행에 저장", app.on_save_row),
    ):
        ttk.Button(bar, text=text, command=cmd).pack(side="left", padx=2)
    app.form = form_mod.ProductForm(app, box, on_change=app.on_form_change)
    app.form.show_placeholders()


def build_output_panel(app, parent) -> None:
    tk, ttk = app.tk, app.ttk
    box = ttk.LabelFrame(parent, text="5. 생성·검증 결과")
    box.pack(fill="both", expand=True, padx=4, pady=4)
    row1 = ttk.Frame(box)
    row1.pack(fill="x", padx=6, pady=(6, 0))
    app.opt_crumb = tk.BooleanVar(value=False)
    ttk.Checkbutton(row1, text="BreadcrumbList 도 함께", variable=app.opt_crumb).pack(side="left")
    app.opt_force = tk.BooleanVar(value=False)
    ttk.Checkbutton(row1, text="규제 경고 무시하고 생성", variable=app.opt_force).pack(
        side="left", padx=10
    )
    row2 = ttk.Frame(box)
    row2.pack(fill="x", padx=6, pady=4)
    for text, cmd in (
        ("스니펫 생성", app.on_generate),
        ("개별 복사", app.on_copy_one),
        ("전체 복사", app.on_copy_all),
        ("파일 저장", app.on_save_files),
        ("CSV 내보내기", app.on_export_csv),
    ):
        ttk.Button(row2, text=text, command=cmd).pack(side="left", padx=2)
    row3 = ttk.Frame(box)
    row3.pack(fill="x", padx=6, pady=(0, 4))
    for text, cmd in (
        ("적용 확인", app.on_verify),
        ("구글 테스트(선택)", lambda: app.on_google(False)),
        ("구글 일괄 테스트", lambda: app.on_google(True)),
        ("구글 테스트 창 열기", app.on_google_window),
        ("출력 폴더 열기", app.on_open_out),
    ):
        ttk.Button(row3, text=text, command=cmd).pack(side="left", padx=2)
    app.out = tk.Text(box, height=13, wrap="word")
    osb = ttk.Scrollbar(box, orient="vertical", command=app.out.yview)
    app.out.configure(yscrollcommand=osb.set)
    app.out.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
    osb.pack(side="left", fill="y", pady=6)
    app.out.tag_configure("bad", foreground="#c00000", underline=True)
    app.out.tag_configure("head", font=("Segoe UI", 10, "bold"))


def build_input_panel(app, parent) -> None:
    """1절 입력 영역. 정확한 순서대로 버튼을 둔다."""
    tk, ttk = app.tk, app.ttk
    top = ttk.LabelFrame(parent, text="1. 상품 불러오기 (위 버튼이 더 정확합니다)")
    top.pack(fill="x", padx=4, pady=4)
    row1 = ttk.Frame(top)
    row1.pack(fill="x", padx=6, pady=(6, 0))
    ttk.Button(row1, text="관리자 엑셀 가져오기 (가장 정확)", command=app.on_admin_excel).pack(
        side="left", padx=2
    )
    ttk.Button(row1, text="판매 중 상품 불러오기 (권장)", command=app.on_discover).pack(
        side="left", padx=2
    )
    ttk.Button(
        row1, text="사이트맵(2020년 파일)에서 불러오기 (참고용)", command=app.on_sitemap
    ).pack(side="left", padx=2)
    tk.Label(
        top,
        text=(
            "관리자 > 상품 관리 > 상품 목록 > 엑셀다운로드 파일을 넣으면 가장 정확합니다."
            " 파일이 없으면 '판매 중 상품 불러오기' 를 쓰세요."
            " 사이트맵 파일은 2020년에 만들어진 것이라 지금 진열과 다릅니다."
        ),
        fg="#707070",
        justify="left",
        wraplength=720,
    ).pack(anchor="w", padx=8, pady=(2, 0))
    app.input = tk.Text(top, height=4, wrap="none")
    app.input.pack(fill="x", padx=6, pady=(4, 2))
    app.input.insert("1.0", "https://cstpillow.com/goods/goods_view.php?goodsNo=11")
    row2 = ttk.Frame(top)
    row2.pack(fill="x", padx=6, pady=(0, 6))
    for text, cmd in (
        ("2. 가져오기(수집·파싱)", app.on_fetch),
        ("입력 비우기", lambda: app.input.delete("1.0", "end")),
        ("표 비우기", app.on_clear_rows),
        ("사이트맵 만들기", app.on_make_sitemap),
        ("llms.txt 만들기", app.on_make_llms),
    ):
        ttk.Button(row2, text=text, command=cmd).pack(side="left", padx=2)


# ---------------------------------------------------------------------- 화면 꾸미기

TAB_ACTIVE_BG = "#1f5fbf"
TAB_ACTIVE_FG = "#ffffff"
TAB_IDLE_BG = "#e6e6e6"
TAB_IDLE_FG = "#202020"
BASE_FONT = ("맑은 고딕", 11)


def apply_style(app) -> None:
    """탭을 크게 하고 기본 글꼴을 키운다. 어느 탭이 열려 있는지 색으로 보이게 한다."""
    tk, ttk = app.tk, app.ttk
    style = ttk.Style(app.root)
    try:
        style.theme_use("clam")  # 색을 마음대로 줄 수 있는 테마
    except Exception:
        pass
    for name in (
        "TkDefaultFont",
        "TkTextFont",
        "TkMenuFont",
        "TkHeadingFont",
        "TkTooltipFont",
        "TkIconFont",
    ):
        try:
            app.tkfont.nametofont(name).configure(family=BASE_FONT[0], size=BASE_FONT[1])
        except Exception:
            pass
    style.configure("TNotebook", tabmargins=[4, 6, 4, 0], background="#f4f4f4")
    style.configure(
        "TNotebook.Tab",
        font=(BASE_FONT[0], 15, "bold"),
        padding=[22, 10],
        background=TAB_IDLE_BG,
        foreground=TAB_IDLE_FG,
        borderwidth=1,
    )
    # 색만 다르고 크기는 같게 둔다. 기본 테마는 선택 탭을 키우므로 확장을 0 으로 고정한다.
    style.map(
        "TNotebook.Tab",
        background=[("selected", TAB_ACTIVE_BG), ("active", "#cfe0f7")],
        foreground=[("selected", TAB_ACTIVE_FG), ("active", TAB_IDLE_FG)],
        padding=[("selected", [22, 10]), ("!selected", [22, 10])],
        expand=[("selected", [0, 0, 0, 0]), ("!selected", [0, 0, 0, 0])],
    )
    # 버튼이 버튼처럼 보이게 테두리와 입체감을 준다.
    style.configure(
        "TButton",
        font=(BASE_FONT[0], 11),
        padding=[14, 7],
        relief="raised",
        borderwidth=2,
    )
    style.configure(
        "Secondary.TButton",
        font=(BASE_FONT[0], 11),
        padding=[14, 7],
        relief="raised",
        borderwidth=2,
        background="#fbfbfb",
        foreground="#202020",
        bordercolor="#9a9a9a",
        lightcolor="#ffffff",
        darkcolor="#c8c8c8",
    )
    style.map(
        "Secondary.TButton",
        background=[("disabled", "#f0f0f0"), ("pressed", "#dfe7f3"), ("active", "#eef3fb")],
        foreground=[("disabled", "#a0a0a0")],
        relief=[("pressed", "sunken")],
    )
    style.configure(
        "Primary.TButton",
        font=(BASE_FONT[0], 11, "bold"),
        padding=[14, 7],
        relief="raised",
        borderwidth=2,
        background=TAB_ACTIVE_BG,
        foreground="#ffffff",
        bordercolor="#17488f",
        lightcolor="#4a84d8",
        darkcolor="#17488f",
    )
    style.map(
        "Primary.TButton",
        background=[("disabled", "#a9bede"), ("pressed", "#17488f"), ("active", "#2a6fd4")],
        foreground=[("disabled", "#eeeeee")],
        relief=[("pressed", "sunken")],
    )
    style.configure("Tiny.TButton", font=(BASE_FONT[0], 8), padding=[4, 1], borderwidth=1)
    style.configure("Card.TFrame", background="#f7f9fc", relief="solid", borderwidth=1)
    style.configure("TProgressbar", thickness=16)
    style.configure("TLabelframe.Label", font=(BASE_FONT[0], 11, "bold"))
    style.configure("Treeview", font=(BASE_FONT[0], 10), rowheight=26)
    style.configure("Treeview.Heading", font=(BASE_FONT[0], 10, "bold"))
    style.configure("TCombobox", padding=[4, 3])
    style.configure("TEntry", padding=[3, 3])
