// Decides which of the two Hangul readers answers for one document.
//
// There are two, and both are needed:
//
//   - `rhwp` renders the document to Markdown with real tables, merged cells included.
//     Nearly every Hangul document on the delivery share is a form, so that structure is
//     most of what the document says.
//   - The built-in reader (document-extract-hangul.ts) never loses body text and is the
//     only one that can tell a password-protected file, a distribution copy and a
//     pre-2005 file apart from a damaged one.
//
// The order is rhwp first with the built-in reader as a floor, because rhwp's Markdown
// export drops the body entirely on some documents while still exiting successfully
// (measured: 4 of 68 files on the delivery share). A silent success is worse than a
// visible failure, so the richer output is only accepted when it carries at least a set
// share of the text the reader that never loses any produced.
//
// This module holds the decision once. The document index and the file preview both read
// Hangul documents, and two copies of this rule would drift into two different answers
// for the same file.
import {
  extractHangulText,
  isHangulExtension,
  type HangulExtractFailure,
} from "./document-extract-hangul.js";
import { convertHangulToMarkdown } from "./document-hangul-cli.js";

/** What a Hangul document turned out to be. */
export type HangulReading =
  | { ok: true; kind: "markdown"; content: string }
  | { ok: true; kind: "text"; content: string }
  | { ok: false; reason: HangulExtractFailure };

/** rhwp output below this share of the built-in reader's text is treated as a loss. */
const HANGUL_MARKDOWN_MIN_RATIO = 0.6;

/**
 * Counts the characters that carry meaning, ignoring Markdown table punctuation.
 *
 * Comparing raw lengths would favour the Markdown renderer for free: a row of empty
 * cells is all pipes and dashes and no content.
 */
function contentLength(value: string): number {
  return (value.match(/[^\s|-]/gu) ?? []).length;
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

/** Reads one Hangul word processor document with the better of the two readers. */
export async function readHangulDocument(params: {
  buffer: Buffer;
  sourceExtension: string;
}): Promise<HangulReading> {
  if (!isHangulExtension(params.sourceExtension)) {
    return { ok: false, reason: "unsupported-format" };
  }
  const extracted = await extractHangulText({
    buffer: params.buffer,
    sourceExtension: params.sourceExtension,
  });
  if (!extracted.ok && (extracted.reason === "encrypted" || extracted.reason === "distribution")) {
    // Nobody can read these without the secret, so do not pay for a subprocess to find out.
    return { ok: false, reason: extracted.reason };
  }
  const rendered = await convertHangulToMarkdown({
    buffer: params.buffer,
    sourceExtension: params.sourceExtension,
  });
  if (rendered.ok) {
    const floor = extracted.ok ? contentLength(extracted.text) * HANGUL_MARKDOWN_MIN_RATIO : 0;
    if (contentLength(rendered.markdown) >= floor) {
      return { content: normalizeText(rendered.markdown), kind: "markdown", ok: true };
    }
  }
  if (extracted.ok) {
    return { content: normalizeText(extracted.text), kind: "text", ok: true };
  }
  return { ok: false, reason: extracted.reason };
}
