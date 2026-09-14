"""생성 탭 화면. 번호 붙은 단계 카드와 진행 표시줄로 순서를 보이게 만든다."""

from __future__ import annotations

import form as form_mod
import verify_round

STEPS = [
    ("1단계", "상품 불러오기"),
    ("2단계", "정보 가져오기"),
    ("3단계", "항목 입력"),
    ("4단계", "스니펫 생성"),
    ("5단계", "검증"),
]

DONE_BG = "#1e7a32"
NOW_BG = "#1f5fbf"
REST_BG = "#d8d8d8"
DONE_FG = "#ffffff"
REST_FG = "#606060"
BADGE_BG = "#1f5fbf"
CARD_NOTE = "#5a5a5a"


def plain_buttons(app) -> list:
    """ttk 가 아닌 tk.Button 목록. 작업 중 잠그기에서 함께 다룬다."""
    if not hasattr(app, "plain_button_list"):
        app.plain_button_list = []
    return app.plain_button_list


def build_start_bar(app, parent) -> None:
    """화면 맨 위에 두는 시작 띠. 처음 쓰는 사람이 여기만 누르면 된다."""
    tk, ttk = app.tk, app.ttk
    bar = tk.Frame(parent, bg="#1f5fbf")
    bar.pack(fill="x", padx=6, pady=(6, 2))
    tk.Label(
        bar,
        text="처음이면 여기를 누르세요",
        bg="#1f5fbf",
        fg="#ffffff",
        font=("맑은 고딕", 12, "bold"),
        padx=12,
        pady=10,
    ).pack(side="left")
    start = tk.Button(
        bar,
        text="판매 중인 상품 모두 불러오기",
        command=app.on_quick_start,
        font=("맑은 고딕", 13, "bold"),
        bg="#ffd54a",
        fg="#202020",
        activebackground="#ffe484",
        relief="raised",
        bd=3,
        padx=18,
        pady=6,
        cursor="hand2",
    )
    start.pack(side="left", padx=8, pady=6)
    app.start_button = start
    recheck = tk.Button(
        bar,
        text="적용 결과 다시 확인",
        command=lambda: verify_round.run(app),
        font=("맑은 고딕", 12, "bold"),
        bg="#1e7a32",
        fg="#ffffff",
        activebackground="#2a9443",
        activeforeground="#ffffff",
        relief="raised",
        bd=3,
        padx=14,
        pady=6,
        cursor="hand2",
    )
    recheck.pack(side="left", padx=(0, 8), pady=6)
    plain_buttons(app).append(recheck)
    tk.Label(
        bar,
        text="처음이면 노란 버튼. 고도몰에 붙여넣기를 끝냈으면 초록 버튼을 누르세요.",
        bg="#1f5fbf",
        fg="#dce8fb",
        font=("맑은 고딕", 10),
        justify="left",
    ).pack(side="left", padx=6)
    tk.Button(
        bar,
        text="사용법 보기",
        command=lambda: app.nb.select(app.tab_help),
        font=("맑은 고딕", 10),
        relief="raised",
        bd=2,
        padx=10,
        cursor="hand2",
    ).pack(side="right", padx=10, pady=6)


# ---------------------------------------------------------------------- 진행 표시줄


def build_progress(app, parent) -> None:
    tk, ttk = app.tk, app.ttk
    bar = ttk.Frame(parent)
    bar.pack(fill="x", padx=6, pady=(4, 2))
    app.step_labels = []
    for index, (number, name) in enumerate(STEPS):
        cell = tk.Label(
            bar,
            text=f" {number}  {name} ",
            font=("맑은 고딕", 11, "bold"),
            bg=REST_BG,
            fg=REST_FG,
            padx=10,
            pady=6,
            relief="flat",
            bd=0,
        )
        cell.pack(side="left", padx=(0 if index == 0 else 4, 0))
        app.step_labels.append(cell)
    app.step_note = tk.Label(bar, text="", font=("맑은 고딕", 10), fg=CARD_NOTE)
    app.step_note.pack(side="left", padx=10)


def set_step(app, step: int, note: str = "") -> None:
    """지금 몇 단계인지 색으로 보여 주고 다음에 누를 버튼을 강조한다."""
    app.step = step
    for index, cell in enumerate(getattr(app, "step_labels", []), 1):
        if index < step:
            cell.configure(bg=DONE_BG, fg=DONE_FG)
        elif index == step:
            cell.configure(bg=NOW_BG, fg=DONE_FG)
        else:
            cell.configure(bg=REST_BG, fg=REST_FG)
    if note and hasattr(app, "step_note"):
        app.step_note.configure(text=note)
    for number, button in getattr(app, "step_buttons", {}).items():
        try:
            button.configure(style="Primary.TButton" if number == step else "Secondary.TButton")
        except Exception:
            pass


def scroll_area(app, parent):
    """세로로 스크롤되는 영역. 마우스가 그 위에 있을 때만 그 영역이 움직인다."""
    tk, ttk = app.tk, app.ttk
    wrap = ttk.Frame(parent)
    wrap.pack(fill="both", expand=True)
    canvas = tk.Canvas(wrap, highlightthickness=0, borderwidth=0)
    bar = ttk.Scrollbar(wrap, orient="vertical", command=canvas.yview)
    canvas.configure(yscrollcommand=bar.set)
    canvas.pack(side="left", fill="both", expand=True)
    bar.pack(side="left", fill="y")
    inner = ttk.Frame(canvas)
    window = canvas.create_window((0, 0), window=inner, anchor="nw")

    def resize(_event=None):
        canvas.configure(scrollregion=canvas.bbox("all"))
        canvas.itemconfigure(window, width=canvas.winfo_width())

    inner.bind("<Configure>", resize)
    canvas.bind("<Configure>", resize)

    def wheel(event):
        try:
            target = event.widget.winfo_containing(event.x_root, event.y_root)
        except Exception:
            target = None
        node = target
        while node is not None:
            if node.winfo_class() in ("Text", "Treeview", "Listbox"):
                # 그 위젯이 스크롤할 내용이 있으면 맡긴다. 없으면 바깥 영역을 굴린다.
                try:
                    first, last = node.yview()
                except Exception:
                    return None
                if (first, last) != (0.0, 1.0):
                    return None
            if node is canvas:
                canvas.yview_scroll(-1 * (event.delta // 120), "units")
                return "break"
            node = getattr(node, "master", None)
        return None

    canvas.bind_all("<MouseWheel>", wheel, add="+")
    app.left_canvas = canvas
    return inner


# ---------------------------------------------------------------------- 카드 골격


def card(app, parent, number: str, title: str, note: str = ""):
    """번호 배지가 붙은 카드 한 장."""
    tk, ttk = app.tk, app.ttk
    outer = ttk.Frame(parent, style="Card.TFrame", padding=0)
    outer.pack(fill="x", padx=4, pady=4)
    head = tk.Frame(outer, bg="#f0f4fa")
    head.pack(fill="x")
    tk.Label(
        head,
        text=number,
        font=("맑은 고딕", 11, "bold"),
        bg=BADGE_BG,
        fg="#ffffff",
        padx=10,
        pady=4,
    ).pack(side="left", padx=(6, 8), pady=5)
    tk.Label(head, text=title, font=("맑은 고딕", 12, "bold"), bg="#f0f4fa").pack(
        side="left", pady=5
    )
    body = ttk.Frame(outer)
    body.pack(fill="x", padx=8, pady=(3, 6))
    if note:
        tk.Label(
            body, text=note, fg=CARD_NOTE, font=("맑은 고딕", 9), justify="left", wraplength=760
        ).pack(anchor="w", pady=(0, 4))
    return body


def button(app, parent, text: str, command, step: int | None = None, side: str = "left"):
    widget = app.ttk.Button(parent, text=text, command=command, style="Secondary.TButton")
    widget.pack(side=side, padx=3, pady=2)
    if step is not None:
        app.step_buttons[step] = widget
    return widget


# ---------------------------------------------------------------------- 1·2단계


def build_input_panel(app, parent) -> None:
    tk, ttk = app.tk, app.ttk
    app.step_buttons = getattr(app, "step_buttons", {})
    body = card(
        app,
        parent,
        "1단계",
        "상품 불러오기",
        "무엇을 눌러야 할지 모르면 아래 파란 버튼 하나만 누르세요. "
        "라포르몰에서 지금 판매 중인 상품을 찾아 정보까지 가져옵니다.",
    )
    big = ttk.Frame(body)
    big.pack(fill="x", pady=(0, 6))
    tk.Label(
        big, text="여기부터", bg="#1f5fbf", fg="#ffffff",
        font=("맑은 고딕", 10, "bold"), padx=8, pady=3,
    ).pack(side="left", padx=(0, 6))
    start = ttk.Button(
        big,
        text="판매 중인 상품 모두 불러오기 (1·2단계 한 번에)",
        command=app.on_quick_start,
        style="Primary.TButton",
    )
    start.pack(side="left")
    app.step_buttons[1] = start
    tk.Label(
        body, text="따로 하고 싶을 때만 아래 버튼을 씁니다.", fg=CARD_NOTE, font=("맑은 고딕", 9)
    ).pack(anchor="w")
    row = ttk.Frame(body)
    row.pack(fill="x")
    button(app, row, "관리자 엑셀 파일로 불러오기", app.on_admin_excel)
    button(app, row, "판매 중 상품 목록만 보기", app.on_discover)
    button(app, row, "사이트맵에서 불러오기", app.on_sitemap)
    app.input = tk.Text(body, height=3, wrap="none", font=("맑은 고딕", 10))
    app.input.pack(fill="x", pady=(6, 2))
    tk.Label(
        body,
        text="이 칸은 직접 주소를 넣고 싶을 때만 씁니다. 상품 주소나 숫자(goodsNo)를 줄마다 하나씩.",
        fg=CARD_NOTE,
        font=("맑은 고딕", 9),
    ).pack(anchor="w")

    body2 = card(
        app,
        parent,
        "2단계",
        "정보 가져오기",
        "위 파란 버튼을 눌렀으면 이 단계는 이미 끝났습니다. "
        "주소를 직접 넣었을 때만 누르세요.",
    )
    row2 = ttk.Frame(body2)
    row2.pack(fill="x")
    button(app, row2, "가져오기(수집·파싱)", app.on_fetch, step=2)
    button(app, row2, "입력 비우기", lambda: app.input.delete("1.0", "end"))
    button(app, row2, "표 비우기", app.on_clear_rows)


# ---------------------------------------------------------------------- 3단계


def build_form_panel(app, parent) -> None:
    ttk = app.ttk
    box = ttk.Labelframe(parent, text=" 3단계  항목 입력 ", padding=6)
    box.pack(fill="both", expand=True, padx=4, pady=4)
    app.tk.Label(
        box,
        text="왼쪽 목록에서 행을 누르면 그 상품이 여기에 뜹니다. 빨간 별표 항목을 모두 채우세요.",
        fg=CARD_NOTE,
        font=("맑은 고딕", 9),
        justify="left",
        wraplength=520,
    ).pack(anchor="w", pady=(0, 4))
    bar = ttk.Frame(box)
    bar.pack(fill="x", pady=(0, 4))
    for text, cmd in (
        ("예시로 채우기", app.on_fill_example),
        ("폼 비우기", app.on_clear_form),
        ("설명 초안", app.on_draft),
    ):
        ttk.Button(bar, text=text, command=cmd, style="Secondary.TButton").pack(
            side="left", padx=3
        )
    button(app, bar, "행에 저장", app.on_save_row, step=3)
    app.form = form_mod.ProductForm(app, box, on_change=app.on_form_change)
    app.form.show_placeholders()


# ---------------------------------------------------------------------- 4·5단계·도구


def build_output_panel(app, parent) -> None:
    tk, ttk = app.tk, app.ttk
    body = card(
        app,
        parent,
        "4단계",
        "스니펫 생성·복사",
        "필수 항목이 비면 어떤 항목인지 알려 주고 생성하지 않습니다.",
    )
    row = ttk.Frame(body)
    row.pack(fill="x")
    button(app, row, "스니펫 생성", app.on_generate, step=4)
    button(app, row, "개별 복사", app.on_copy_one)
    button(app, row, "전체 복사", app.on_copy_all)
    button(app, row, "파일 저장", app.on_save_files)
    opts = ttk.Frame(body)
    opts.pack(fill="x", pady=(4, 0))
    app.opt_crumb = tk.BooleanVar(value=False)
    ttk.Checkbutton(opts, text="BreadcrumbList 도 함께", variable=app.opt_crumb).pack(side="left")
    app.opt_force = tk.BooleanVar(value=False)
    ttk.Checkbutton(opts, text="규제 경고 무시하고 생성", variable=app.opt_force).pack(
        side="left", padx=10
    )

    body2 = card(
        app,
        parent,
        "5단계",
        "검증",
        "고도몰에 붙여넣은 뒤 확인합니다. 최종 판정은 구글 리치 결과 테스트입니다.",
    )
    big5 = ttk.Frame(body2)
    big5.pack(fill="x", pady=(0, 6))
    recheck = tk.Button(
        big5,
        text="붙여넣기 끝났으면 다시 불러와 검증",
        command=lambda: verify_round.run(app),
        font=("맑은 고딕", 13, "bold"),
        bg="#1e7a32",
        fg="#ffffff",
        activebackground="#2a9443",
        activeforeground="#ffffff",
        relief="raised",
        bd=3,
        padx=18,
        pady=7,
        cursor="hand2",
    )
    recheck.pack(side="left")
    plain_buttons(app).append(recheck)
    app.recheck_button = recheck
    tk.Label(
        body2,
        text="상품을 다시 불러와 표의 '페이지 적용' 열을 갱신하고 결과를 알려 줍니다"
        " (적용됨·미적용·가격 불일치 개수). 새로 적용된 행은 초록으로 강조됩니다.",
        fg=CARD_NOTE,
        font=("맑은 고딕", 9),
        justify="left",
        wraplength=760,
    ).pack(anchor="w", pady=(0, 4))
    row2 = ttk.Frame(body2)
    row2.pack(fill="x")
    button(app, row2, "적용 확인", app.on_verify, step=5)
    button(app, row2, "구글 테스트(선택)", lambda: app.on_google(False))
    button(app, row2, "구글 일괄 테스트", lambda: app.on_google(True))
    button(app, row2, "구글 테스트 창 열기", app.on_google_window)

    tools = card(app, parent, "도구", "그때그때 쓰는 것", "")
    row3 = ttk.Frame(tools)
    row3.pack(fill="x")
    for text, cmd in (
        ("사이트맵 만들기", app.on_make_sitemap),
        ("llms.txt 만들기", app.on_make_llms),
        ("CSV 내보내기", app.on_export_csv),
        ("출력 폴더 열기", app.on_open_out),
    ):
        ttk.Button(row3, text=text, command=cmd, style="Secondary.TButton").pack(
            side="left", padx=3, pady=2
        )

    out_box = ttk.Labelframe(parent, text=" 결과 ", padding=4)
    out_box.pack(fill="x", padx=4, pady=4)
    app.out = tk.Text(out_box, height=6, wrap="word", font=("맑은 고딕", 10))
    osb = ttk.Scrollbar(out_box, orient="vertical", command=app.out.yview)
    app.out.configure(yscrollcommand=osb.set)
    app.out.pack(side="left", fill="x", expand=True)
    osb.pack(side="left", fill="y")
    app.out.tag_configure("bad", foreground="#c00000", underline=True)
    app.out.tag_configure("head", font=("맑은 고딕", 11, "bold"))


# ---------------------------------------------------------------------- 진행 패널


def build_progress_panel(app, parent) -> None:
    """언제나 보이는 진행 표시줄. 개수를 아는 작업은 n/N, 모르는 작업은 계속 움직인다."""
    tk, ttk = app.tk, app.ttk
    box = ttk.Frame(parent)
    box.pack(fill="x", side="bottom")
    app.progress_text = tk.StringVar(value="대기 중")
    app.progress_bar = ttk.Progressbar(box, mode="determinate", maximum=100, length=260)
    app.progress_bar.pack(side="left", padx=(8, 6), pady=4)
    tk.Label(
        box, textvariable=app.progress_text, font=("맑은 고딕", 10), fg="#303030", anchor="w"
    ).pack(side="left", fill="x", expand=True)
    app.cancel_button = ttk.Button(
        box, text="취소", command=app.on_cancel, style="Secondary.TButton", state="disabled"
    )
    app.cancel_button.pack(side="right", padx=8, pady=4)


def walk_buttons(widget, found=None):
    found = [] if found is None else found
    for child in widget.winfo_children():
        if child.winfo_class() == "TButton":
            found.append(child)
        walk_buttons(child, found)
    return found


def set_buttons_enabled(app, enabled: bool) -> None:
    """작업 중에는 버튼을 잠그고 취소만 열어 둔다."""
    state = "normal" if enabled else "disabled"
    for widget in [getattr(app, "start_button", None)] + plain_buttons(app):
        if widget is None:
            continue
        try:
            widget.configure(state=state)
        except Exception:
            pass
    for button in walk_buttons(app.tab_main):
        if button is getattr(app, "cancel_button", None):
            continue
        try:
            button.configure(state=state)
        except Exception:
            pass
    try:
        app.cancel_button.configure(state="disabled" if enabled else "normal")
    except Exception:
        pass


def progress_start(app, label: str, total: int | None) -> None:
    bar = getattr(app, "progress_bar", None)
    if bar is None:
        return
    if total:
        bar.stop()
        bar.configure(mode="determinate", maximum=total, value=0)
    else:
        bar.configure(mode="indeterminate")
        bar.start(60)
    app.progress_text.set(label or "작업 중...")


def progress_update(app, done: int, total: int | None, text: str) -> None:
    bar = getattr(app, "progress_bar", None)
    if bar is None:
        return
    if total:
        bar.configure(mode="determinate", maximum=total, value=done)
        app.progress_text.set(f"{text} ({done}/{total})")
    else:
        app.progress_text.set(text)


def progress_end(app, text: str) -> None:
    bar = getattr(app, "progress_bar", None)
    if bar is None:
        return
    bar.stop()
    bar.configure(mode="determinate", maximum=100, value=100)
    app.progress_text.set(text)


def reload_history_safe(app) -> None:
    try:
        import ui_tabs

        ui_tabs.reload_history(app)
    except Exception:
        pass
