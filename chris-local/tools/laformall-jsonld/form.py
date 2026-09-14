"""상품 하나를 편집하는 세로 폼. 라벨 + 필수/선택 표시 + 입력칸 + 설명 한 줄."""

from __future__ import annotations

import fields

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

        def resize(_event=None):
            canvas.configure(scrollregion=canvas.bbox("all"))
            canvas.itemconfigure(window, width=canvas.winfo_width())

        inner.bind("<Configure>", resize)
        canvas.bind("<Configure>", resize)

        def wheel(event):
            canvas.yview_scroll(-1 * (event.delta // 120), "units")

        canvas.bind_all("<MouseWheel>", wheel, add="+")
        self.canvas = canvas
        return inner

    def _section(self, title: str, note: str) -> None:
        tk, ttk = self.tk, self.ttk
        box = ttk.Frame(self.body)
        box.pack(fill="x", pady=(10, 2), padx=6)
        tk.Label(box, text=title, font=("Segoe UI", 10, "bold"), anchor="w").pack(anchor="w")
        tk.Label(box, text=note, fg=HINT, anchor="w", justify="left", wraplength=560).pack(anchor="w")

    def _label_row(self, parent, spec: fields.FieldSpec) -> None:
        tk = self.tk
        row = tk.Frame(parent)
        row.pack(fill="x")
        if spec.required:
            tk.Label(row, text="*", fg=RED, font=("Segoe UI", 10, "bold")).pack(side="left")
            tk.Label(row, text="[필수]", fg=RED, font=("Segoe UI", 8, "bold")).pack(side="left")
        else:
            tk.Label(row, text="[선택]", fg=BLUE, font=("Segoe UI", 8)).pack(side="left", padx=(9, 0))
        tk.Label(row, text=" " + spec.label, font=("Segoe UI", 9, "bold")).pack(side="left")
        if spec.key == "description":
            self.counter = tk.Label(row, text="0자", fg=HINT, font=("Segoe UI", 8))
            self.counter.pack(side="left", padx=6)

    def _hint_row(self, parent, spec: fields.FieldSpec) -> None:
        self.tk.Label(
            parent, text=spec.hint, fg=HINT, font=("Segoe UI", 8), anchor="w",
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
                widget = tk.Text(box, height=spec.rows, wrap="word", font=("Segoe UI", 9))
                widget.pack(fill="x")
                self.widgets[spec.key] = widget
                self.holders[spec.key] = Placeholder(widget, spec.placeholder, "area")
                if spec.key == "description":
                    widget.bind("<KeyRelease>", self._count, add="+")
                widget.bind("<FocusOut>", self._changed, add="+")
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
                entry = ttk.Entry(box, textvariable=var, width=spec.width, state="readonly")
                entry.pack(anchor="w", fill="x" if spec.width > 40 else None)
                self.widgets[spec.key] = var
            else:
                entry = ttk.Entry(box, width=spec.width, font=("Segoe UI", 9))
                entry.pack(anchor="w", fill="x" if spec.width > 40 else None)
                self.widgets[spec.key] = entry
                self.holders[spec.key] = Placeholder(entry, spec.placeholder, "entry")
                entry.bind("<FocusOut>", self._changed, add="+")
            self._hint_row(box, spec)

    def _build_faq(self, parent, spec: fields.FieldSpec) -> None:
        tk, ttk = self.tk, self.ttk
        example = fields.EXAMPLE["faq"]
        for index in range(fields.FAQ_ROWS):
            row = ttk.Frame(parent)
            row.pack(fill="x", pady=1)
            question = ttk.Entry(row, width=30, font=("Segoe UI", 9))
            question.pack(side="left", fill="x", expand=True)
            answer = ttk.Entry(row, width=40, font=("Segoe UI", 9))
            answer.pack(side="left", fill="x", expand=True, padx=(4, 0))
            sample = example[index] if index < len(example) else ("", "")
            hq = Placeholder(question, sample[0] or "하루 몇 분 사용하나요?", "entry")
            ha = Placeholder(answer, sample[1] or "1회 10분, 하루 2회를 권장합니다.", "entry")
            hq.show()
            ha.show()
            question.bind("<FocusOut>", self._changed, add="+")
            answer.bind("<FocusOut>", self._changed, add="+")
            self.faq_rows.append((hq, ha))

    # ------------------------------------------------------------------ 동작
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
        pairs = prod.faq_pairs()
        for index, (hq, ha) in enumerate(self.faq_rows):
            if index < len(pairs):
                hq.set(pairs[index][0])
                ha.set(pairs[index][1])
            else:
                hq.set("")
                ha.set("")
        self._count()

    def collect(self, prod) -> None:
        """폼 값을 상품에 담는다."""
        for key, holder in self.holders.items():
            setattr(prod, key, holder.value())
        label = self.widgets["availability_label"].get()
        prod.availability = fields.AVAILABILITY.get(label, fields.IN_STOCK)
        faq: list[tuple[str, str]] = []
        for hq, ha in self.faq_rows:
            question, answer = hq.value(), ha.value()
            if question and answer:
                faq.append((question, answer))
        prod.faq = faq
