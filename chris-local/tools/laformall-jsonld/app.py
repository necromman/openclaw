"""라포르몰 JSON-LD 생성기 - 진입점과 생성 탭 GUI.

CLI: laformall-jsonld.exe --cli --out <폴더> <URL 또는 goodsNo ...>
     laformall-jsonld.exe --selftest --out <폴더>
     laformall-jsonld.exe --google-test <goodsNo ...> [--out <폴더>]
"""

from __future__ import annotations

import os
import queue
import sys
import threading
import webbrowser
from datetime import datetime
from pathlib import Path

import browser
import claims
import fetcher
import fields
import google_test
import history
import schema
import settings
import ui_tabs
import validator

APP_TITLE = "라포르몰 JSON-LD 생성기"

COLUMNS = [
    ("mark", "", 34),
    ("goods_no", "goodsNo", 66),
    ("name", "상품명", 190),
    ("price", "판매가", 78),
    ("local", "로컬 판정", 110),
    ("missing", "부족 항목", 76),
    ("applied", "적용 확인", 88),
    ("google", "구글 결과", 150),
]


class App:
    def __init__(self) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk, self.ttk = tk, ttk
        self.cfg = settings.load()
        self.rows: list[fetcher.Product] = []
        self.snippets: dict[str, str] = {}
        self.verdicts: dict[str, validator.Verdict] = {}
        self.google: dict[str, google_test.GoogleResult] = {}
        self.jobs: queue.Queue = queue.Queue()
        self.busy = False
        self.root = tk.Tk()
        self.root.title(APP_TITLE)
        self.root.geometry("1380x900")
        self.root.minsize(1100, 720)
        self.nb = ttk.Notebook(self.root)
        self.nb.pack(fill="both", expand=True, padx=6, pady=6)
        self.tab_main = ttk.Frame(self.nb)
        self.tab_hist = ttk.Frame(self.nb)
        self.tab_set = ttk.Frame(self.nb)
        self.tab_help = ttk.Frame(self.nb)
        for frame, label in (
            (self.tab_main, "생성"),
            (self.tab_hist, "이력"),
            (self.tab_set, "설정"),
            (self.tab_help, "도움말"),
        ):
            self.nb.add(frame, text=label)
        self.status = tk.StringVar(value="도움말 탭의 필수 항목 표를 먼저 보세요")
        self._build_main()
        ui_tabs.build_history_tab(self, self.tab_hist)
        ui_tabs.build_settings_tab(self, self.tab_set)
        ui_tabs.build_help_tab(self, self.tab_help)
        ttk.Label(self.root, textvariable=self.status, anchor="w", relief="sunken").pack(
            fill="x", side="bottom"
        )
        self.nb.select(self.tab_help)  # 첫 화면은 도움말
        self.root.after(120, self._drain)

    # ---------------------------------------------------------------- 생성 탭
    def _build_main(self) -> None:
        tk, ttk = self.tk, self.ttk
        frame = self.tab_main
        pane = ttk.Panedwindow(frame, orient="horizontal")
        pane.pack(fill="both", expand=True)
        left = ttk.Frame(pane)
        right = ttk.Frame(pane)
        pane.add(left, weight=3)
        pane.add(right, weight=2)

        top = ttk.LabelFrame(left, text="1. 상품 URL 또는 goodsNo 붙여넣기 (줄·쉼표·공백 구분)")
        top.pack(fill="x", padx=4, pady=4)
        self.input = tk.Text(top, height=4, wrap="none")
        self.input.pack(fill="x", padx=6, pady=(6, 2))
        self.input.insert("1.0", "https://cstpillow.com/goods/goods_view.php?goodsNo=11")
        btns = ttk.Frame(top)
        btns.pack(fill="x", padx=6, pady=(0, 6))
        for text, cmd in (
            ("사이트맵에서 전체 상품 불러오기", self.on_sitemap),
            ("2. 가져오기", self.on_fetch),
            ("입력 비우기", lambda: self.input.delete("1.0", "end")),
            ("표 비우기", self.on_clear_rows),
        ):
            ttk.Button(btns, text=text, command=cmd).pack(side="left", padx=2)

        mid = ttk.LabelFrame(left, text="3. 상품 목록 (행을 누르면 오른쪽 폼에 뜹니다)")
        mid.pack(fill="both", expand=True, padx=4, pady=4)
        self.tree = ttk.Treeview(
            mid, columns=[c[0] for c in COLUMNS], show="headings", selectmode="extended"
        )
        for key, label, width in COLUMNS:
            self.tree.heading(key, text=label)
            self.tree.column(key, width=width, anchor="center" if key == "mark" else "w")
        vsb = ttk.Scrollbar(mid, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        self.tree.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
        vsb.pack(side="left", fill="y", pady=6)
        self.tree.bind("<<TreeviewSelect>>", self.on_pick_row)
        self.tree.bind("<Double-1>", self.on_row_detail)
        for status, colour in validator.COLOR.items():
            self.tree.tag_configure(
                f"v-{status}", background=colour, foreground=validator.FOREGROUND[status]
            )

        ui_tabs.build_output_panel(self, left)
        ui_tabs.build_form_panel(self, right)

    # ---------------------------------------------------------------- 유틸
    def log(self, text: str) -> None:
        self.status.set(text)

    def write_out(self, text: str, bad_terms: list[str] | None = None) -> None:
        self.out.delete("1.0", "end")
        self.out.insert("1.0", text)
        for term in set(bad_terms or []):
            if not term:
                continue
            start = "1.0"
            while True:
                pos = self.out.search(term, start, stopindex="end")
                if not pos:
                    break
                end = f"{pos}+{len(term)}c"
                self.out.tag_add("bad", pos, end)
                start = end

    def info(self, title: str, text: str) -> None:
        from tkinter import messagebox

        messagebox.showinfo(title, text)

    def warn(self, title: str, text: str) -> None:
        from tkinter import messagebox

        messagebox.showwarning(title, text)

    def ask(self, title: str, text: str) -> bool:
        from tkinter import messagebox

        return bool(messagebox.askyesno(title, text))

    def clipboard(self, text: str) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.root.update()

    def _drain(self) -> None:
        try:
            while True:
                fn = self.jobs.get_nowait()
                try:
                    fn()
                except Exception as exc:
                    self.log(f"오류: {exc}")
        except queue.Empty:
            pass
        self.root.after(120, self._drain)

    def background(self, work, done) -> None:
        if self.busy:
            self.warn("작업 중", "앞선 작업이 끝나기를 기다려 주세요.")
            return
        self.busy = True

        def runner():
            try:
                result = work()
                self.jobs.put(lambda: self._finish(done, result, None))
            except Exception as exc:
                self.jobs.put(lambda exc=exc: self._finish(done, None, exc))

        threading.Thread(target=runner, daemon=True).start()

    def _finish(self, done, result, exc) -> None:
        self.busy = False
        done(result, exc)

    def fetch_client(self) -> fetcher.Fetcher:
        return fetcher.Fetcher(self.cfg)

    def selected_rows(self) -> list[fetcher.Product]:
        keys = list(self.tree.selection())
        if not keys:
            return list(self.rows)
        return [r for r in self.rows if r.goods_no in keys]

    def find_row(self, goods_no: str) -> fetcher.Product | None:
        for row in self.rows:
            if row.goods_no == goods_no:
                return row
        return None

    def current_row(self) -> fetcher.Product | None:
        keys = list(self.tree.selection())
        return self.find_row(keys[0]) if keys else None

    def reverdict(self, row: fetcher.Product) -> validator.Verdict:
        verdict = validator.check(row)
        self.verdicts[row.goods_no] = verdict
        row.local_status = verdict.status
        return verdict

    def _row_tag(self, row: fetcher.Product) -> str:
        verdict = self.verdicts.get(row.goods_no)
        google = self.google.get(row.goods_no)
        if row.error:
            return f"v-{validator.STATUS_ERROR}"
        if google and google.status in (google_test.STATUS_ERROR, google_test.STATUS_NONE):
            return f"v-{validator.STATUS_ERROR}"
        if not verdict:
            return f"v-{validator.STATUS_NONE}"
        if verdict.status == validator.STATUS_PASS and google and google.status == google_test.STATUS_WARN:
            return f"v-{validator.STATUS_WARN}"
        return f"v-{verdict.status}"

    def refresh_tree(self, keep: str = "") -> None:
        selection = keep or (list(self.tree.selection()) or [""])[0]
        self.tree.delete(*self.tree.get_children())
        for row in self.rows:
            verdict = self.verdicts.get(row.goods_no)
            google = self.google.get(row.goods_no)
            price = f"{int(row.price):,}" if str(row.price).isdigit() else row.price
            self.tree.insert(
                "",
                "end",
                iid=row.goods_no,
                values=(
                    verdict.indicator if verdict else "-",
                    row.goods_no,
                    row.name,
                    price,
                    verdict.summary() if verdict else "미검증",
                    str(len(verdict.missing)) if verdict else "",
                    row.applied or "",
                    google.summary() if google else "",
                ),
                tags=(self._row_tag(row),),
            )
        if selection and self.tree.exists(selection):
            self.tree.selection_set(selection)

    # ---------------------------------------------------------------- 동작
    def on_clear_rows(self) -> None:
        self.rows, self.snippets, self.verdicts, self.google = [], {}, {}, {}
        self.refresh_tree()
        self.write_out("")
        self.log("표를 비웠습니다")

    def on_sitemap(self) -> None:
        self.log("사이트맵을 받는 중")
        client = self.fetch_client()

        def done(result, exc):
            if exc:
                self.warn("사이트맵", f"불러오지 못했습니다.\n{exc}")
                return
            urls = [fetcher.product_url(g, self.cfg["domain"]) for g in result]
            self.input.delete("1.0", "end")
            self.input.insert("1.0", "\n".join(urls))
            self.log(f"사이트맵에서 상품 {len(urls)}개를 불러왔습니다")

        self.background(client.sitemap_goods, done)

    def on_fetch(self) -> None:
        goods, bad = fetcher.parse_input(self.input.get("1.0", "end"))
        if not goods:
            self.warn("입력", "상품 URL 또는 goodsNo 를 한 개 이상 넣으세요.")
            return
        if bad:
            self.log("해석하지 못한 입력: " + ", ".join(bad[:5]))
        client = self.fetch_client()
        self.log(f"상품 {len(goods)}개 수집 중")

        def done(result, exc):
            if exc:
                self.warn("수집", f"실패했습니다.\n{exc}")
                return
            keep = {r.goods_no: r for r in self.rows}
            for prod in result:
                old = keep.get(prod.goods_no)
                if old:
                    for key in fields.BY_KEY:
                        if key in ("url", "goods_no", "currency", "availability_label"):
                            continue
                        value = getattr(old, key, "")
                        if value and not getattr(prod, key, ""):
                            setattr(prod, key, value)
                    if old.faq:
                        prod.faq = old.faq
                keep[prod.goods_no] = prod
                self.reverdict(prod)
            self.rows = [keep[g] for g in goods] + [r for k, r in keep.items() if k not in goods]
            self.refresh_tree()
            if self.rows:
                self.tree.selection_set(self.rows[0].goods_no)
            failed = [r for r in result if r.error]
            self.log(
                f"수집 {len(result) - len(failed)}건, 실패 {len(failed)}건. "
                "오른쪽 폼의 필수 항목을 채우세요."
            )

        self.background(lambda: [client.fetch_product(g) for g in goods], done)

    def on_pick_row(self, _event=None) -> None:
        row = self.current_row()
        if row:
            self.form.load(row)

    def on_row_detail(self, _event=None) -> None:
        row = self.current_row()
        if not row:
            return
        verdict = self.verdicts.get(row.goods_no) or self.reverdict(row)
        parts = [f"goodsNo={row.goods_no} {row.name}", "", verdict.report()]
        if row.applied:
            parts += ["", f"적용 확인: {row.applied} - {row.applied_detail}"]
        google = self.google.get(row.goods_no)
        if google:
            parts += [
                "",
                f"구글 리치 결과 테스트 ({google.at}): {google.summary()}",
                google.note or "",
                "",
                google.text[:2000],
            ]
        self.write_out("\n".join(parts))

    def on_form_change(self) -> None:
        row = self.current_row()
        if not row:
            return
        self.form.collect(row)
        self.reverdict(row)
        self.refresh_tree(keep=row.goods_no)

    def on_save_row(self) -> None:
        row = self.current_row()
        if not row:
            self.warn("편집", "표에서 행을 먼저 선택하세요.")
            return
        self.on_form_change()
        verdict = self.verdicts.get(row.goods_no)
        self.write_out(verdict.report() if verdict else "")
        self.log(f"goodsNo={row.goods_no} 저장. 로컬 판정 {verdict.status if verdict else ''}")

    def on_fill_example(self) -> None:
        self.form.fill_example()
        self.log("goodsNo=11 CST 스탠다드 예시 값을 채웠습니다. 실제 값으로 고쳐 쓰세요.")

    def on_clear_form(self) -> None:
        self.form.clear()
        self.log("폼을 비웠습니다")

    def on_draft(self) -> None:
        holder = self.form.holders.get("description")
        name = self.form.holders["name"].value()
        if not name:
            self.warn("초안", "먼저 행을 선택하거나 상품명을 입력하세요.")
            return
        holder.set(claims.draft_description(name))
        self.form._count()
        self.on_form_change()
        self.log("초안을 넣었습니다. 사실만 남기고 고쳐 쓰세요.")

    def _claim_findings(self, rows) -> tuple[list[str], list[str]]:
        lines: list[str] = []
        terms: list[str] = []
        for row in rows:
            for finding in claims.check_fields(row.claim_fields()):
                lines.append(f"goodsNo={row.goods_no} {finding.line()}")
                terms.append(finding.term)
        return lines, terms

    def on_generate(self) -> None:
        rows = self.selected_rows()
        if not rows:
            self.warn("생성", "표에 행이 없습니다. 먼저 가져오기를 하세요.")
            return
        current = self.current_row()
        if current:
            self.form.collect(current)
        blocked: list[str] = []
        for row in rows:
            missing = fields.missing_required(row)
            if missing:
                blocked.append(f"goodsNo={row.goods_no}: " + ", ".join(missing))
        if blocked:
            text = "필수 항목이 비어 있어 생성하지 않았습니다.\n\n" + "\n".join(blocked)
            self.write_out(text)
            self.warn("필수 항목 누락", text[:900])
            return
        findings, terms = self._claim_findings(rows)
        if findings and not self.opt_force.get():
            self.write_out(
                f"규제 경고 - {len(findings)}건 (생성을 멈췄습니다)\n\n"
                + "\n".join(findings)
                + "\n\n허용 문안 예시:\n"
                + "\n".join("  - " + s for s in claims.ALLOWED_EXAMPLES)
                + "\n\n"
                + claims.DISCLAIMER
                + "\n\n그래도 생성하려면 '규제 경고 무시하고 생성' 을 켜세요.",
                terms,
            )
            self.warn("규제 경고", f"금지 표현 {len(findings)}건을 찾았습니다. 결과 창을 확인하세요.")
            return
        client = self.fetch_client()
        check_head = bool(self.cfg.get("check_image_head", True))
        crumb = bool(self.opt_crumb.get())
        domain = self.cfg["domain"]
        self.log("검증·생성 중")

        def work():
            out = []
            for row in rows:
                image_ok = client.head_ok(row.image) if (check_head and row.image) else None
                verdict = validator.check(row, image_ok)
                data = schema.build_product(row)
                errors = schema.validate(row, data, image_ok)
                text = schema.full_snippet(row, with_breadcrumb=crumb, domain=domain)
                out.append((row, text, errors, verdict))
            return out

        def done(result, exc):
            if exc:
                self.warn("생성", f"실패했습니다.\n{exc}")
                return
            blocks, bad = [], 0
            for row, text, errors, verdict in result:
                self.snippets[row.goods_no] = text
                self.verdicts[row.goods_no] = verdict
                row.local_status = verdict.status
                row.status = "검증 실패: " + "; ".join(errors) if errors else "생성됨"
                bad += 1 if errors else 0
                blocks.append(f"<!-- goodsNo={row.goods_no} {row.name} -->\n{text}")
                if verdict.warnings:
                    blocks.append("<!-- 권장 항목 미입력: " + "; ".join(verdict.warnings) + " -->")
                history.add(
                    row,
                    text,
                    schema.snippet_hash(text),
                    "",
                    errors,
                    [f.line() for f in claims.check_fields(row.claim_fields())],
                    verdict=verdict,
                )
            self.refresh_tree()
            self.write_out("\n\n".join(blocks))
            ui_tabs.reload_history(self)
            self.log(
                f"생성 {len(result)}건, 검증 실패 {bad}건. 최종 판정은 구글 테스트로 확인하세요."
            )

        self.background(work, done)

    def on_copy_one(self) -> None:
        row = self.current_row()
        text = self.snippets.get(row.goods_no) if row else None
        if not text:
            self.warn("복사", "행을 선택하고 먼저 스니펫을 생성하세요.")
            return
        self.clipboard(text)
        self.log(f"goodsNo={row.goods_no} 스니펫을 복사했습니다")

    def on_copy_all(self) -> None:
        blocks = [self.snippets[r.goods_no] for r in self.selected_rows() if r.goods_no in self.snippets]
        if not blocks:
            self.warn("복사", "먼저 스니펫을 생성하세요.")
            return
        self.clipboard("\n\n".join(blocks))
        self.log(f"{len(blocks)}건을 복사했습니다")

    def on_save_files(self) -> None:
        rows = [r for r in self.selected_rows() if r.goods_no in self.snippets]
        if not rows:
            self.warn("저장", "먼저 스니펫을 생성하세요.")
            return
        out_dir = Path(self.cfg["out_dir"])
        out_dir.mkdir(parents=True, exist_ok=True)
        bundle = []
        for row in rows:
            text = self.snippets[row.goods_no]
            (out_dir / schema.file_name(row)).write_text(text + "\n", encoding="utf-8")
            bundle.append(f"<!-- goodsNo={row.goods_no} {row.name} -->\n{text}")
        bundle_path = out_dir / schema.bundle_name()
        bundle_path.write_text("\n\n".join(bundle) + "\n", encoding="utf-8")
        self.info("저장 완료", f"{out_dir}\n\n개별 {len(rows)}개 + 묶음 {bundle_path.name}")
        self.log(f"{len(rows)}개 파일을 저장했습니다")

    def on_export_csv(self) -> None:
        rows = self.selected_rows()
        if not rows:
            self.warn("CSV", "표에 행이 없습니다.")
            return
        path = Path(self.cfg["out_dir"]) / f"rows-{datetime.now().strftime('%Y%m%d-%H%M')}.csv"
        payload = []
        for row in rows:
            item = row.as_dict()
            snippet_text = self.snippets.get(row.goods_no, "")
            verdict = self.verdicts.get(row.goods_no)
            google = self.google.get(row.goods_no)
            item["hash"] = schema.snippet_hash(snippet_text) if snippet_text else ""
            item["result"] = row.status
            item["local_status"] = verdict.status if verdict else ""
            item["local_missing"] = ", ".join(verdict.missing) if verdict else ""
            item["google_status"] = google.status if google else ""
            item["google_detail"] = google.summary() if google else ""
            item["at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            payload.append(item)
        history.export_csv(payload, path)
        self.info("CSV 내보내기", str(path))
        self.log(f"CSV 를 저장했습니다: {path}")

    def on_verify(self) -> None:
        rows = self.selected_rows()
        if not rows:
            self.warn("적용 확인", "표에 행이 없습니다.")
            return
        client = self.fetch_client()
        self.log(f"{len(rows)}건 적용 확인 중")

        def done(result, exc):
            if exc:
                self.warn("적용 확인", f"실패했습니다.\n{exc}")
                return
            lines = []
            for row, verdict, detail in result:
                row.applied, row.applied_detail = verdict, detail
                lines.append(f"goodsNo={row.goods_no} {verdict} - {detail}")
            self.refresh_tree()
            self.write_out("적용 확인 결과\n\n" + "\n".join(lines))
            self.log("적용 확인 완료")

        self.background(lambda: [(r, *client.verify_applied(r.goods_no)) for r in rows], done)

    def on_google(self, everything: bool) -> None:
        rows = self.rows if everything else self.selected_rows()
        if not rows:
            self.warn("구글 테스트", "표에 행이 없습니다.")
            return
        ok, note = google_test.available()
        if not ok:
            self.warn("구글 테스트", note)
            return
        pairs = [(r.goods_no, r.url) for r in rows]
        self.log(f"구글 리치 결과 테스트 {len(pairs)}건 시작(한 건당 최대 90초)")

        def progress(index, total, goods_no):
            self.jobs.put(
                lambda: self.log(f"구글 테스트 {index}/{total} 진행 중 (goodsNo={goods_no})")
            )

        def done(result, exc):
            if exc:
                self.warn("구글 테스트", f"실패했습니다.\n{exc}")
                return
            lines = []
            for item in result:
                self.google[item.goods_no] = item
                row = self.find_row(item.goods_no)
                if row:
                    row.google_status, row.google_at = item.status, item.at
                history.add_google(item.as_dict())
                lines.append(f"goodsNo={item.goods_no} {item.summary()} {item.note}".strip())
            self.refresh_tree()
            self.write_out(
                "구글 리치 결과 테스트 결과 (최종 판정)\n\n"
                + "\n".join(lines)
                + "\n\n행을 두 번 누르면 원문 결과를 볼 수 있습니다."
            )
            ui_tabs.reload_history(self)
            self.log(f"구글 테스트 {len(result)}건 완료")

        self.background(lambda: google_test.run_many(pairs, progress), done)

    def on_google_window(self) -> None:
        """구글 테스트 화면을 프로그램이 직접 띄운다.

        pywebview 는 반드시 주 스레드에서 돌아야 해서 tkinter 와 한 프로세스에서
        같이 쓸 수 없다. 그래서 GUI 에서는 설치된 Edge·Chrome 창을 이 프로그램이
        띄운다(전용 임시 프로필). 파이썬을 부르지 않는다.
        """
        row = self.current_row() or (self.rows[0] if self.rows else None)
        if not row:
            self.warn("구글 테스트", "표에서 행을 선택하세요.")
            return
        url = google_test.test_url(row.url)
        ok, note = browser.open_window(url)
        if ok:
            self.log(f"goodsNo={row.goods_no} 구글 테스트 화면을 {note} 창으로 열었습니다")
            return
        webbrowser.open(url)
        self.log(f"기본 브라우저로 열었습니다({note})")

    def on_open_out(self) -> None:
        out_dir = Path(self.cfg["out_dir"])
        out_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.startfile(str(out_dir))
        except Exception:
            webbrowser.open(out_dir.as_uri())

    def run(self) -> None:
        self.root.mainloop()


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--webview" in argv:
        index = argv.index("--webview")
        url = argv[index + 1] if index + 1 < len(argv) else ""
        ok, note = google_test.open_embedded(url)
        if not ok:
            google_test.open_external(url)
        return 0
    if any(a in argv for a in ("--cli", "--selftest", "--google-test")):
        import cli

        return cli.run_cli(argv)
    if "--help" in argv or "-h" in argv:
        print(
            "라포르몰 JSON-LD 생성기\n"
            "  (옵션 없음)  GUI 실행\n"
            "  --cli --out <폴더> <URL 또는 goodsNo ...> [--desc-file desc.csv]\n"
            "  --selftest --out <폴더>\n"
            "  --google-test <goodsNo ...> [--out <폴더>]"
        )
        return 0
    App().run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
