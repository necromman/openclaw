# Workspace AGENTS.md addition: PDF generation with Korean text

This block is appended to the running instance's workspace `AGENTS.md`
(`~/openclaw-local/.openclaw/workspace/AGENTS.md`). It is kept here so any
machine can reproduce the same rule without guessing at the wording.

Install:

```bash
cat ~/openclaw/chris-local/workspace-pdf-rules.md \
  | sed -n '/^## Making PDFs/,$p' \
  >> ~/openclaw-local/.openclaw/workspace/AGENTS.md
```

The text below the marker is what actually goes into `AGENTS.md`.

---

## Making PDFs (Korean text must not break)

PDF output that contains Korean fails, or silently prints boxes, whenever the
renderer cannot find a CJK font. Follow these rules.

**Preferred route: LibreOffice headless.** It embeds the fonts it uses, so the
resulting PDF renders the same on a machine that has no Korean font at all.

```bash
soffice --headless --norestore --convert-to pdf --outdir <dir> <file>
```

It accepts `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp`, `.rtf`, `.html`
and `.txt`. Writing Markdown or HTML first and converting is usually the
shortest correct path.

**If you render HTML to PDF yourself** (headless Chromium, weasyprint, wkhtmltopdf),
name a Korean font family explicitly. Never rely on a bare `sans-serif`:

```css
body {
  font-family: "Noto Sans CJK KR", "NanumGothic", system-ui, sans-serif;
}
```

Installed families on this host: `Noto Sans CJK KR`, `Noto Serif CJK KR`,
`NanumGothic`, `NanumMyeongjo`, `NanumBarunGothic`, `NanumSquare`,
`NanumGothicCoding`.

**Check before you blame the document.** These two commands answer "is a Korean
font present" in one line each:

```bash
fc-list :lang=ko family | sort -u     # families that can draw Hangul
fc-match "Noto Sans CJK KR"           # what the system actually resolves to
```

**Verify the output, do not assume.** After producing a PDF, confirm the Korean
glyphs are really embedded:

```bash
python3 -c 'import re,sys; d=open(sys.argv[1],"rb").read(); \
print(sorted({m.decode() for m in re.findall(rb"/BaseFont\s*/([A-Za-z0-9+#,._-]+)", d)}))' out.pdf
```

A Korean document whose font list shows only Latin faces (DejaVu, Helvetica,
Liberation) did not embed Hangul and will print as boxes.

**When it fails, say why.** If a PDF step errors or the font check comes back
empty, tell the user the real cause in plain words, for example: "PDF generation
failed because the host has no Korean font installed; install `fonts-noto-cjk`
and retry." Do not retry silently, do not fall back to an English-only document,
and do not hand over a PDF you have not font-checked.
