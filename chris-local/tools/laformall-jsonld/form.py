"""상품 하나를 편집하는 세로 폼. 라벨 + 필수/선택 표시 + 입력칸 + 설명 한 줄."""

from __future__ import annotations

import fields
import images

GREY = "#909090"
RED = "#c00000"
BLUE = "#205080"
HINT = "#707070"


class Placeholder:
    """입력칸에 회색 예시 값을 넣고 포커스가 오면 지운다."""

    def __init__(self, widget, text: str, kind: str):
        self.widget = widget
        self.text = text
        self.kind = kind
        self.active = False
        widget.bind("<FocusIn>", self._on_in, add="+")
        widget.bind("<FocusOut>", self._on_out, add="+")

    def _read(self) -> str:
        if self.kind == "area":
            return self.widget.get("1.0", "end").strip()
        return self.widget.get().strip()

    def _has_focus(self) -> bool:
        """지금 이 칸에 커서가 있는가. 입력 중인 칸에 예시를 다시 넣지 않기 위한 확인."""
        try:
            return self.widget.focus_get() is self.widget
        except Exception:
            return False

    def _write(self, value: str, colour: str) -> None:
        if self.kind == "area":
            self.widget.delete("1.0", "end")
            self.widget.insert("1.0", value)
        else:
            self.widget.delete(0, "end")
            self.widget.insert(0, value)
        self.widget.configure(foreground=colour)

    def show(self) -> None:
        if not self.text:
            return
        if self._has_focus():
            # 커서가 있는 칸에는 회색 예시를 넣지 않는다. 넣으면 사람이 이어서 치는
            # 글자 뒤에 예시가 붙어 버린다(FAQ 답변칸에서 실제로 났던 일).
            self._write("", "black")
            self.active = False
            return
        self._write(self.text, GREY)
        self.active = True

    def clear_if_active(self) -> None:
        if self.active:
            self._write("", "black")
            self.active = False

    def _on_in(self, _event=None) -> None:
        self.clear_if_active()

    def _on_out(self, _event=None) -> None:
        if not self._read():
            self.show()

    def value(self) -> str:
        return "" if self.active else self._read()

    def set(self, value: str) -> None:
        if str(value or "").strip():
            self._write(str(value), "black")
            self.active = False
        else:
            self.show()


def row_of(app):
    """폼이 잡고 있는 행. 표 선택이 아니라 폼에 실린 상품을 기준으로 본다."""
    formy = getattr(app, "form", None)
    if formy is None or not formy.goods_no:
        return None
    return app.find_row(formy.goods_no)


def reload_into(app, goods_no: str = "") -> None:
    """행 자료를 새로 받은 뒤 폼을 다시 그린다."""
    row = app.find_row(goods_no) if goods_no else (row_of(app) or app.current_row())
    if row is None:
        row = app.rows[0] if app.rows else None
    if row is not None:
        app.form.load(row)


def save_into(app, quiet: bool = True):
    """폼 값을 그 행에 담고 판정·표·상태줄을 갱신한다(자동 저장의 본체)."""
    row = row_of(app)
    if row is None:
        return None
    app.form.collect(row)
    verdict = app.reverdict(row)
    app.refresh_tree()
    full, half = app.form.faq_counts()
    note = f", FAQ {full}쌍" if full else ""
    if half:
        note += f" (한쪽만 채운 쌍 {half}개는 생성에서 빠집니다)"
    app.log(
        f"goodsNo={row.goods_no} 저장됨 - {verdict.summary()}{note}",
        "warn" if verdict.errors else "ok",
    )
    return row


class ProductForm:
    """fields.FIELDS 순서대로 세로로 쌓는 폼."""

    def __init__(self, app, parent, on_change=None):
        self.app = app
        self.tk = app.tk
        self.ttk = app.ttk
        self.on_change = on_change
        self.widgets: dict = {}
        self.holders: dict[str, Placeholder] = {}
        self.faq_rows: list[tuple] = []
        self.goods_no = ""
        self.body = self._scroll_area(parent)
        self._build()

    # ------------------------------------------------------------------ 골격
    def _scroll_area(self, parent):
        tk, ttk = self.tk, self.ttk
        wrap = ttk.Frame(parent)
        wrap.pack(fill="both", expand=True)
        canvas = tk.Canvas(wrap, highlightthickness=0, borderwidth=0)
        bar = ttk.Scrollbar(wrap, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=bar.set)
        canvas.pack(side="left", fill="both", expand=True)
        bar.pack(side="left", fill="y")
        inner = ttk.Frame(canvas)
        window = canvas.create_window((0, 0), window=inner, anchor="nw")
        self.canvas = canvas

        def resize(_event=None):
            canvas.configure(scrollregion=canvas.bbox("all"))
            canvas.itemconfigure(window, width=canvas.winfo_width())

        inner.bind("<Configure>", resize)
        canvas.bind("<Configure>", resize)

        def wheel(event):
            """마우스가 폼 위에 있을 때만 폼을 굴린다.

            전역으로 묶어 두면 결과 텍스트를 굴릴 때 폼까지 함께 움직인다.
            Text·Treeview·Listbox 위에서는 그 위젯의 기본 동작에 맡긴다.
            """
            try:
                target = event.widget.winfo_containing(event.x_root, event.y_root)
            except Exception:
                target = None
            node = target
            while node is not None:
                if node.winfo_class() in ("Text", "Treeview", "Listbox"):
                    # 그 위젯이 스크롤할 내용이 있으면 맡긴다. 없으면 폼을 굴린다.
                    try:
                        span = node.yview()
                    except Exception:
                        return None
                    if tuple(span) != (0.0, 1.0):
                        return None
                if node is canvas:
                    canvas.yview_scroll(-1 * (event.delta // 120), "units")
                    return "break"
                node = getattr(node, "master", None)
            return None

        canvas.bind_all("<MouseWheel>", wheel, add="+")
        self.canvas = canvas
        return inner

    def _section(self, title: str, note: str) -> None:
        tk, ttk = self.tk, self.ttk
        box = ttk.Frame(self.body)
        box.pack(fill="x", pady=(10, 2), padx=6)
        tk.Label(box, text=title, font=("맑은 고딕", 12, "bold"), anchor="w").pack(anchor="w")
        tk.Label(box, text=note, fg=HINT, anchor="w", justify="left", wraplength=560).pack(anchor="w")

    def _label_row(self, parent, spec: fields.FieldSpec) -> None:
        tk = self.tk
        row = tk.Frame(parent)
        row.pack(fill="x")
        tk.Label(row, text=spec.label, font=("맑은 고딕", 11, "bold")).pack(side="left")
        if spec.required:
            tk.Label(row, text=" *", fg=RED, font=("맑은 고딕", 12, "bold")).pack(side="left")
        badge_text, badge_bg = ("필수", "#c00000") if spec.required else ("선택", "#5a7fb5")
        tk.Label(
            row, text=badge_text, bg=badge_bg, fg="#ffffff",
            font=("맑은 고딕", 8, "bold"), padx=5, pady=0,
        ).pack(side="left", padx=(6, 0))
        if spec.key in fields.MANUAL_ONLY:
            tk.Label(
                row, text="직접 입력", bg="#e8e2c8", fg="#5a4a10",
                font=("맑은 고딕", 8), padx=5,
            ).pack(side="left", padx=(4, 0))
        if spec.key == "description":
            self.counter = tk.Label(row, text="0자", fg=HINT, font=("맑은 고딕", 9))
            self.counter.pack(side="left", padx=6)
            for text, delta in (("칸 늘리기", 2), ("칸 줄이기", -2)):
                self.ttk.Button(
                    row, text=text, width=8, style="Tiny.TButton",
                    command=lambda d=delta: self._resize_desc(d),
                ).pack(side="right", padx=2)

    def _hint_row(self, parent, spec: fields.FieldSpec) -> None:
        self.tk.Label(
            parent, text=spec.hint, fg=HINT, font=("맑은 고딕", 9), anchor="w",
            justify="left", wraplength=600,
        ).pack(anchor="w", pady=(0, 4))

    # ------------------------------------------------------------------ 필드
    def _build(self) -> None:
        tk, ttk = self.tk, self.ttk
        self._section(
            "필수 항목",
            "빨간 별표가 붙은 항목은 모두 채워야 생성됩니다. 정보가 많을수록 AI 답변에 인용될 여지가 커집니다.",
        )
        done_required = False
        for spec in fields.FIELDS:
            if not spec.required and not done_required:
                self._section(
                    "선택 항목",
                    "비워 두면 스니펫에서 빠집니다. 값이 있으면 구글 권장 속성까지 채워집니다.",
                )
                done_required = True
            box = ttk.Frame(self.body)
            box.pack(fill="x", padx=6, pady=1)
            self._label_row(box, spec)
            if spec.kind == "faq":
                self._build_faq(box, spec)
            elif spec.kind in ("area", "props"):
                widget = tk.Text(box, height=spec.rows, wrap="word", font=("맑은 고딕", 11))
                widget.pack(fill="x")
                self.widgets[spec.key] = widget
                self.holders[spec.key] = Placeholder(widget, spec.placeholder, "area")
                if spec.key == "description":
                    widget.bind("<KeyRelease>", self._count, add="+")
                widget.bind("<FocusOut>", self._on_blur, add="+")
            elif spec.kind == "combo":
                var = tk.StringVar(value=spec.options[0] if spec.options else "")
                combo = ttk.Combobox(
                    box, textvariable=var, values=list(spec.options), width=spec.width, state="readonly"
                )
                combo.pack(anchor="w")
                combo.bind("<<ComboboxSelected>>", self._changed, add="+")
                self.widgets[spec.key] = var
            elif spec.kind in ("auto", "fixed"):
                var = tk.StringVar(value=spec.placeholder if spec.kind == "fixed" else "")
                entry = ttk.Entry(box, textvariable=var, state="readonly", font=("맑은 고딕", 11))
                entry.pack(anchor="w", fill="x", expand=True)
                self.widgets[spec.key] = var
            else:
                entry = ttk.Entry(box, font=("맑은 고딕", 11))
                entry.pack(anchor="w", fill="x", expand=True)
                self.widgets[spec.key] = entry
                self.holders[spec.key] = Placeholder(entry, spec.placeholder, "entry")
                entry.bind("<FocusOut>", self._on_blur, add="+")
                if spec.key == "image":
                    self._build_image_tools(box)
            self._hint_row(box, spec)
        self._build_bottom_bar()

    def _build_bottom_bar(self) -> None:
        """폼 맨 아래에도 저장 버튼을 둔다. FAQ 는 폼의 끝이라 위 버튼이 화면 밖이다."""
        tk, ttk = self.tk, self.ttk
        box = ttk.Frame(self.body)
        box.pack(fill="x", padx=6, pady=(10, 14))
        tk.Label(
            box,
            text="값을 고치면 칸을 벗어날 때 자동으로 행에 저장됩니다. 아래 버튼은 확인용입니다.",
            fg=HINT, font=("맑은 고딕", 9), anchor="w", justify="left", wraplength=560,
        ).pack(anchor="w", pady=(0, 3))
        self.save_button_bottom = ttk.Button(
            box, text="행에 저장", command=self.app.on_save_row, style="Primary.TButton"
        )
        self.save_button_bottom.pack(anchor="w")

    def _build_faq(self, parent, spec: fields.FieldSpec) -> None:
        tk, ttk = self.tk, self.ttk
        example = fields.EXAMPLE["faq"]
        tk.Label(
            parent,
            text="FAQ 는 선택이지만 있으면 별도 FAQPage 정보표가 함께 생성됩니다."
            " 질문과 답변을 한 쌍으로 채우세요(한쪽만 채운 쌍은 입력은 남지만 생성에서 빠집니다).",
            bg="#f0f4fa", fg="#205080", font=("맑은 고딕", 9), justify="left",
            wraplength=560, padx=6, pady=3, anchor="w",
        ).pack(fill="x", pady=(0, 4))
        for index in range(fields.FAQ_ROWS):
            row = ttk.Frame(parent)
            row.pack(fill="x", pady=(0, 6))
            tk.Label(
                row, text=f"{index + 1}번 쌍  질문 / 답변", fg=HINT, font=("맑은 고딕", 9), anchor="w"
            ).pack(anchor="w")
            question = ttk.Entry(row, font=("맑은 고딕", 11))
            question.pack(fill="x")
            answer = tk.Text(row, height=2, wrap="word", font=("맑은 고딕", 11))
            answer.pack(fill="x", pady=(2, 0))
            sample = example[index] if index < len(example) else example[0]
            hq = Placeholder(question, f"질문 예시: {sample[0]}", "entry")
            ha = Placeholder(answer, f"답변 예시: {sample[1]}", "area")
            hq.show()
            ha.show()
            question.bind("<FocusOut>", self._on_blur, add="+")
            answer.bind("<FocusOut>", self._on_blur, add="+")
            self.faq_rows.append((hq, ha))


    # ------------------------------------------------------------------ 이미지
    def _build_image_tools(self, parent) -> None:
        tk, ttk = self.tk, self.ttk
        bar = ttk.Frame(parent)
        bar.pack(fill="x", pady=(2, 0))
        ttk.Button(bar, text="이미지 고르기", command=self._pick_image).pack(side="left")
        self.image_size = tk.Label(bar, text="", fg=HINT, font=("맑은 고딕", 9))
        self.image_size.pack(side="left", padx=8)
        self.image_preview = tk.Label(
            parent, text="(미리보기는 이미지를 고르면 나옵니다)", fg=HINT, font=("맑은 고딕", 9)
        )
        self.image_preview.pack(anchor="w", pady=(2, 0))

    def _pick_image(self) -> None:
        row = self.app.form_row() or self.app.current_row()
        if not row:
            self.app.warn("이미지 고르기", "표에서 상품을 먼저 선택하세요.")
            return
        self.collect(row)
        images.pick_dialog(self.app, row, self._set_image)

    def _set_image(self, url: str) -> None:
        self.holders["image"].set(url)
        self.show_preview(url)
        self._changed()

    def show_preview(self, url: str) -> None:
        """고른 이미지의 작은 미리보기와 크기를 보여 준다."""
        if not hasattr(self, "image_preview"):
            return
        if not url:
            self.image_preview.configure(image="", text="(미리보기는 이미지를 고르면 나옵니다)")
            self.image_size.configure(text="")
            return
        try:
            photo = images.thumbnail(url, 160, getattr(self.app, "image_session", None))
            self.image_preview.configure(image=photo, text="")
            self.image_preview.image = photo
        except Exception as exc:
            self.image_preview.configure(image="", text=f"(미리보기 실패: {str(exc)[:40]})")
        size = images.known_size(url)
        if size:
            note = "구글 권장 1200px 이상" if size[0] < images.GOOGLE_RECOMMEND_WIDTH else "권장 크기 충족"
            self.image_size.configure(
                text=f"{size[0]}x{size[1]} / {note}",
                fg=RED if size[0] < images.GOOGLE_RECOMMEND_WIDTH else "#105010",
            )
        else:
            self.image_size.configure(text="크기 미확인", fg=HINT)

    # ------------------------------------------------------------------ 동작
    def _resize_desc(self, delta: int) -> None:
        widget = self.widgets.get("description")
        if widget is None:
            return
        height = max(2, min(20, int(widget.cget("height")) + delta))
        widget.configure(height=height)

    def _count(self, _event=None) -> None:
        holder = self.holders.get("description")
        length = len(holder.value()) if holder else 0
        colour = HINT
        if length and length < 60:
            colour = RED
        elif length:
            colour = "#105010"
        self.counter.configure(text=f"{length}자 (60~160자 권장)", fg=colour)

    def _changed(self, _event=None) -> None:
        if self.on_change:
            self.on_change()

    def _on_blur(self, _event=None) -> None:
        """칸을 벗어나면 바로 행에 저장한다.

        한 번 더 늦게 저장하는 이유: 윈도우 한글 IME 는 조합 중인 글자를 포커스가
        떠날 때 확정한다. 그 글자가 FocusOut 처리보다 늦게 칸에 들어오는 경우가
        있어 마지막 글자가 사라진다. 잠시 뒤 한 번 더 읽어 그 글자까지 담는다.
        """
        self._changed()
        try:
            self.app.root.after(90, self._changed)
        except Exception:
            pass

    def show_placeholders(self) -> None:
        for holder in self.holders.values():
            holder.show()
        self._count()

    def clear(self) -> None:
        for key, widget in self.widgets.items():
            spec = fields.BY_KEY[key]
            if spec.kind in ("auto",):
                widget.set("")
            elif spec.kind == "combo":
                widget.set(spec.options[0])
        for holder in self.holders.values():
            holder.show()
        for hq, ha in self.faq_rows:
            hq.show()
            ha.show()
        self._count()
        self._changed()

    def fill_example(self) -> None:
        data = fields.EXAMPLE
        for key, holder in self.holders.items():
            if key in data:
                holder.set(data[key])
        if "availability_label" in self.widgets:
            self.widgets["availability_label"].set(data["availability_label"])
        for index, (hq, ha) in enumerate(self.faq_rows):
            if index < len(data["faq"]):
                hq.set(data["faq"][index][0])
                ha.set(data["faq"][index][1])
            else:
                hq.show()
                ha.show()
        self._count()
        self._changed()

    def load(self, prod) -> None:
        self.goods_no = prod.goods_no
        self.widgets["url"].set(prod.url)
        self.widgets["goods_no"].set(prod.goods_no)
        self.widgets["currency"].set("KRW")
        self.widgets["availability_label"].set(prod.stock_label)
        for key, holder in self.holders.items():
            holder.set(str(getattr(prod, key, "") or ""))
        # 완성되지 않은 쌍(질문만·답변만)도 그대로 되돌려 놓는다.
        # faq_pairs() 는 생성용으로 완성된 쌍만 내주므로 여기서 쓰면 입력이 지워진다.
        slots = prod.faq_slots() if hasattr(prod, "faq_slots") else prod.faq_pairs()
        for index, (hq, ha) in enumerate(self.faq_rows):
            if index < len(slots):
                hq.set(slots[index][0])
                ha.set(slots[index][1])
            else:
                hq.set("")
                ha.set("")
        self._count()
        self.show_preview(prod.image)

    def collect(self, prod) -> None:
        """폼 값을 상품에 담는다."""
        for key, holder in self.holders.items():
            setattr(prod, key, holder.value())
        label = self.widgets["availability_label"].get()
        prod.availability = fields.AVAILABILITY.get(label, fields.IN_STOCK)
        # 한쪽만 채운 쌍도 칸 자리를 지켜 담는다. 생성할 때 faq_pairs() 가 완성된 쌍만
        # 골라 내보내므로, 여기서 버리면 사람이 치던 글자가 사라진다.
        faq: list[tuple[str, str]] = []
        for hq, ha in self.faq_rows:
            faq.append((hq.value(), ha.value()))
        while faq and not (faq[-1][0] or faq[-1][1]):
            faq.pop()
        prod.faq = faq

    def faq_counts(self) -> tuple[int, int]:
        """(완성된 쌍 수, 한쪽만 채운 쌍 수)."""
        full = half = 0
        for hq, ha in self.faq_rows:
            question, answer = hq.value(), ha.value()
            if question and answer:
                full += 1
            elif question or answer:
                half += 1
        return full, half
