"""이력·설정·도움말 탭. app.App 인스턴스를 받아 위젯을 붙인다."""

from __future__ import annotations

import os
import urllib.parse
import webbrowser
from pathlib import Path

import fetcher
import fields
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

HELP_TEXT = """비개발자용 절차

1. 상품 URL 을 붙여넣습니다.
   - 라포르몰 관리자나 브라우저에서 상품 주소를 복사해 왼쪽 위 칸에 줄마다 하나씩 붙입니다.
   - 숫자만(goodsNo) 붙여도 됩니다. 전체 상품을 한 번에 넣으려면
     "사이트맵에서 전체 상품 불러오기" 를 누릅니다.
2. "가져오기" 를 누릅니다.
   - 상품명·판매가·정가·이미지·재고·제조사·원산지를 사이트에서 읽어 옵니다.
   - 설명·재질·크기·무게·색상은 페이지에서 읽을 수 없어 사람이 채웁니다.
3. 표에서 행을 누르면 오른쪽 폼에 그 상품이 뜹니다. 별표가 붙은 필수 항목을 다 채웁니다.
   - 처음이면 "예시로 채우기" 를 눌러 어떤 값이 들어가는지 보고 실제 값으로 고칩니다.
   - 입력칸의 회색 글씨는 예시이고, 칸을 누르면 사라집니다.
   - 값을 고치면 표의 로컬 판정과 색이 바로 바뀝니다(빨강 오류, 노랑 경고, 초록 통과).
4. "스니펫 생성" 을 누릅니다. 필수 항목이 비었으면 어떤 항목인지 알려 줍니다.
   규제 경고가 나오면 문구를 고칩니다.
5. "개별 복사" 또는 "전체 복사" 로 스니펫을 복사합니다.
   파일로 남기려면 "파일 저장" 을 누릅니다.
6. 고도몰 관리자 > 상품 관리 > 상품 수정 > 상품 상세설명 을 열고
   에디터를 HTML 편집 모드로 바꾼 뒤 맨 아래에 붙여넣고 저장합니다.
7. 상품 페이지를 열어 Ctrl+U(소스 보기)로 application/ld+json 이 있는지 봅니다.
   또는 이 프로그램에서 "적용 확인" 을 누릅니다.
8. "구글 일괄 테스트" 를 누릅니다. 이것이 최종 판정입니다.
   - 상품마다 구글 리치 결과 테스트를 돌려 "유효한 항목 N개" 를 읽어 표에 색으로 표시합니다.
   - 화면으로 직접 보려면 행을 고르고 "구글 테스트 창 열기" 를 누릅니다.
   - 결과는 이력 탭에 남고 CSV 로 내보낼 수 있습니다.

로컬 판정과 구글 테스트

- 로컬 판정은 이 프로그램이 즉시 내는 참고 판정입니다. 구글 필수·권장 속성과
  이 프로그램의 AEO 필수 항목이 채워졌는지만 봅니다.
- 최종 판정은 구글 리치 결과 테스트입니다. 로컬 판정이 통과여도 구글 결과가
  "미감지" 면 붙여넣기나 스킨 설정에 문제가 있다는 뜻입니다.

설치할 것은 없습니다

- 이 프로그램은 실행 파일 하나로 돌아갑니다. 파이썬 같은 것을 따로 깔지 않습니다.
- 구글 자동 테스트만 이 PC 에 Edge 또는 Chrome 이 설치돼 있어야 합니다.
  둘 중 하나가 있으면 프로그램이 알아서 찾아 쓰고, 창은 화면 밖에서 돌아 방해하지
  않습니다. 둘 다 없으면 그 행을 "수동 확인 필요" 로 표시합니다.
- "구글 테스트 창 열기" 는 프로그램이 직접 창을 띄워 결과 화면을 보여 줍니다.

주의

- JSON-LD 의 가격이 화면 가격과 다르면 표시광고 위반이 됩니다.
  가격을 바꾸면 스니펫도 다시 만들어 붙입니다.
- 화면에 없는 별점·후기 수를 넣지 않습니다. aggregateRating 은
  페이지에 실제로 보이는 값이 있을 때만 켭니다.
- 공통 헤더·푸터에 넣지 않습니다. 상품마다 상품 상세설명에만 넣습니다.
  전 상품 한 번에 넣으려면 스킨 goods_view.htm 에 치환코드로 심는 방법을
  따로 검토합니다(이 프로그램은 상품별 스니펫만 만듭니다).
- 설명에 치료·완치·예방·교정·통증 완화·혈액순환 같은 표현을 쓰지 않습니다.
  베개·마사지기는 의료기기 허가를 받지 않은 공산품이고, 이런 표현은
  의료기기 오인 광고로 평가됩니다. 물리 사양과 사용 방법으로 씁니다.
- 이 프로그램의 문구 검사는 사전 대조일 뿐이고 적법성을 보증하지 않습니다.
  최종 판단은 담당자와 법률 검토의 몫입니다.

개발자 메모

- CLI: laformall-jsonld.exe --cli --out <폴더> <URL 또는 goodsNo ...>
       설명 매핑은 --desc-file desc.csv (goodsNo,설명)
- 자기검사: laformall-jsonld.exe --selftest --out <폴더>
- 설정·이력 파일: %APPDATA%\\laformall-jsonld\\
"""


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


def build_help_tab(app, frame) -> None:
    tk, ttk = app.tk, app.ttk
    top = ttk.Frame(frame)
    top.pack(fill="x", padx=6, pady=6)
    ttk.Button(
        top,
        text="구글 리치 결과 테스트 열기",
        command=lambda: webbrowser.open("https://search.google.com/test/rich-results"),
    ).pack(side="left")
    ttk.Button(
        top,
        text="schema.org 검사기 열기",
        command=lambda: webbrowser.open("https://validator.schema.org/"),
    ).pack(side="left", padx=4)
    ttk.Button(
        top,
        text="라포르몰 열기",
        command=lambda: webbrowser.open(app.cfg["domain"]),
    ).pack(side="left")
    text = tk.Text(frame, wrap="word", font=("Segoe UI", 9))
    vsb = ttk.Scrollbar(frame, orient="vertical", command=text.yview)
    text.configure(yscrollcommand=vsb.set)
    text.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
    vsb.pack(side="left", fill="y", pady=6)
    text.tag_configure("h", font=("Segoe UI", 11, "bold"))
    text.tag_configure("req", foreground="#c00000", font=("Segoe UI", 9, "bold"))
    text.tag_configure("opt", foreground="#205080", font=("Segoe UI", 9, "bold"))
    text.insert("end", "필수 항목 표\n", "h")
    text.insert(
        "end",
        "아래 항목은 모두 채워야 스니펫이 생성됩니다. 정보가 많을수록 AI 답변에 인용될 여지가 커집니다.\n\n",
    )
    for label, example, hint in fields.required_table():
        text.insert("end", f"  {label}\n", "req")
        text.insert("end", f"    예시: {example}\n    이유: {hint}\n")
    text.insert("end", "\n선택 항목 표\n", "h")
    text.insert("end", "비워 두면 스니펫에서 빠집니다. 구글 권장 속성이 여기에 있습니다.\n\n")
    for label, example, hint in fields.optional_table():
        text.insert("end", f"  {label}\n", "opt")
        text.insert("end", f"    예시: {example}\n    이유: {hint}\n")
    text.insert("end", "\n" + HELP_TEXT)
    text.configure(state="disabled")


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
