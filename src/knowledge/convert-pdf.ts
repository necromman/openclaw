// PDF text extraction for the knowledge index, one Markdown heading per page.
//
// The page heading is the whole point. A memory citation is a line range inside the
// sidecar, so a reader who lands on line 240 needs the nearest heading above to tell
// them which page of the original to open. Extracting the document as one blob would
// throw that away.
import type { PdfEngine } from "clawpdf";

/** Pages past this are dropped; a scanned archive can carry thousands. */
const MAX_PAGES = 1000;
/** Whole-document character ceiling, so one pathological file cannot fill the index. */
const MAX_TOTAL_CHARS = 400_000;
/** Per-page ceiling, applied before the total so a single page cannot eat the budget. */
const MAX_PAGE_CHARS = 20_000;

let enginePromise: Promise<PdfEngine> | null = null;

async function loadEngine(): Promise<PdfEngine> {
  if (!enginePromise) {
    enginePromise = import("clawpdf")
      .then(({ createEngine }) => createEngine())
      .catch((error: unknown) => {
        enginePromise = null;
        throw new Error("PDF text extraction needs the clawpdf dependency", { cause: error });
      });
  }
  return await enginePromise;
}

/** Releases the shared engine. Only the tests need this; the CLI exits instead. */
export async function releaseKnowledgePdfEngine(): Promise<void> {
  const pending = enginePromise;
  enginePromise = null;
  if (pending) {
    await pending.then((engine) => engine.destroy()).catch(() => {});
  }
}

/**
 * Renders one PDF as Markdown with an `## p.N` heading per page.
 *
 * Returns undefined when the document opens but holds no extractable text at all, which
 * is what a scan without OCR looks like; the caller records that as a skip rather than
 * writing an empty sidecar that would answer searches with nothing.
 */
export async function pdfBufferToMarkdown(buffer: Buffer): Promise<string | undefined> {
  const engine = await loadEngine();
  const document = await engine.open(buffer);
  try {
    const pageCount = Math.min(document.pageCount, MAX_PAGES);
    const sections: string[] = [];
    let used = 0;
    let hadText = false;
    for (let page = 1; page <= pageCount; page += 1) {
      if (used >= MAX_TOTAL_CHARS) {
        sections.push(`## p.${page}\n\n(이후 페이지는 길이 상한으로 생략)`);
        break;
      }
      const raw = document.text({ maxChars: MAX_PAGE_CHARS, pages: [page] });
      const text = raw
        .replace(/\r\n?/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
      used += text.length;
      if (text.length > 0) {
        hadText = true;
      }
      sections.push(text.length > 0 ? `## p.${page}\n\n${text}` : `## p.${page}`);
    }
    return hadText ? sections.join("\n\n") : undefined;
  } finally {
    document.destroy();
  }
}
