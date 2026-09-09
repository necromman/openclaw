// Picks and runs the extractor for one source document.
//
// Nothing here is new machinery: the PDF reader, the OOXML reader and the LibreOffice
// bridge all already exist for the file preview pane. This module only decides which of
// them a given extension goes through and shapes the result as Markdown.
import { convertDocumentToPdf } from "../gateway/document-convert.js";
import { extractHangulText } from "../gateway/document-extract-hangul.js";
import { extractDocumentHtml } from "../gateway/document-extract-html.js";
import { convertHangulToMarkdown } from "../gateway/document-hangul-cli.js";
import { pdfBufferToMarkdown } from "./convert-pdf.js";
import { documentHtmlToMarkdown } from "./html-markdown.js";
import type { KnowledgeConverterId, KnowledgeFailureReason } from "./types.js";

/** Extensions LibreOffice has to render before any text can be read out of them. */
const SOFFICE_EXTENSIONS = new Set(["pptx", "ppt", "doc", "xls", "odt", "ods", "odp", "rtf"]);
/** Extensions that are already text and only need decoding. */
const TEXT_EXTENSIONS = new Set(["md", "txt", "csv"]);
/** Hangul word processor containers, read by the built-in reader. LibreOffice cannot open them. */
const HANGUL_EXTENSIONS = new Set(["hwp", "hwpx"]);

export type KnowledgeConversion =
  | { ok: true; body: string; converter: KnowledgeConverterId }
  | { ok: false; reason: KnowledgeFailureReason | "empty" };

/**
 * Decodes a text file, falling back to CP949 for legacy Korean documents.
 *
 * A `.txt` written on Windows in Korean is almost never UTF-8. Decoding it as UTF-8
 * anyway does not throw by default; it silently produces replacement characters, and the
 * index then holds a file of question marks that no query can ever match. The strict
 * decode is what turns that silent corruption into a branch.
 */
export async function decodeTextBuffer(buffer: Buffer): Promise<string> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    const { default: iconv } = await import("iconv-lite");
    return iconv.decode(buffer, "cp949");
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

async function convertOoxml(
  buffer: Buffer,
  extension: "docx" | "xlsx",
): Promise<KnowledgeConversion> {
  const extracted = await extractDocumentHtml({ buffer, sourceExtension: extension });
  if (extracted.ok) {
    const body = documentHtmlToMarkdown(extracted.html);
    if (body.length > 0) {
      return { body, converter: extension === "docx" ? "docx-html" : "xlsx-html", ok: true };
    }
  }
  // The dependency-free reader handles the common shapes; anything it cannot open (a
  // macro-enabled workbook, a document written by an unusual producer) still has the
  // LibreOffice path behind it, which is present in the delivery image.
  return await convertThroughSoffice(buffer, extension);
}

/**
 * Counts the characters that carry meaning, ignoring Markdown table punctuation.
 *
 * Comparing raw lengths would favour the Markdown renderer for free: a row of empty
 * cells is all pipes and dashes and no content.
 */
function contentLength(value: string): number {
  return (value.match(/[^\s|-]/gu) ?? []).length;
}

/** rhwp output below this share of the built-in reader's text is treated as a loss. */
const HANGUL_MARKDOWN_MIN_RATIO = 0.6;

/**
 * Reads one Hangul word processor document.
 *
 * Two readers, in this order. `rhwp` renders the document to Markdown with real tables,
 * merged cells included, and one `## p.N` heading per page; almost every Hangul document
 * on the delivery share is a form, so that structure is most of what the index is for.
 * When the binary is not installed, or it cannot open a particular file, the built-in
 * dependency-free reader still returns the text.
 *
 * LibreOffice is not in this picture at all: its Hangul filter only understands the
 * pre-2005 format and exits successfully without writing anything for everything else.
 *
 * The failure reason comes from the built-in reader, which can tell a password, a
 * distribution copy and an HWP 3.0 file apart. Reporting all three as one blanket failure
 * would leave an operator unable to tell "nobody can read this" from "this one is broken".
 */
async function convertHangul(buffer: Buffer, extension: string): Promise<KnowledgeConversion> {
  const extracted = await extractHangulText({ buffer, sourceExtension: extension });
  if (!extracted.ok && (extracted.reason === "encrypted" || extracted.reason === "distribution")) {
    // Nobody can read these without the secret, so do not pay for a subprocess to find out.
    return { ok: false, reason: extracted.reason };
  }
  const rendered = await convertHangulToMarkdown({ buffer, sourceExtension: extension });
  if (rendered.ok) {
    // rhwp renders most documents better than the built-in reader, but on some it emits
    // a page of empty table rows and drops the body entirely (measured on the delivery
    // share). That failure looks like success, so it is caught by comparing against the
    // reader that never loses text, and only then is the richer output accepted.
    const floor = extracted.ok ? contentLength(extracted.text) * HANGUL_MARKDOWN_MIN_RATIO : 0;
    if (contentLength(rendered.markdown) >= floor) {
      return { body: normalizeText(rendered.markdown), converter: "hwp-markdown", ok: true };
    }
  }
  if (extracted.ok) {
    return { body: normalizeText(extracted.text), converter: "hwp-text", ok: true };
  }
  const reason = extracted.reason;
  if (reason === "empty") {
    return { ok: false, reason };
  }
  return { ok: false, reason: reason === "legacy-format" ? "legacy-format" : "conversion-failed" };
}

async function convertThroughSoffice(
  buffer: Buffer,
  extension: string,
): Promise<KnowledgeConversion> {
  const rendered = await convertDocumentToPdf({ buffer, sourceExtension: extension });
  if (!rendered.ok) {
    return { ok: false, reason: rendered.reason };
  }
  const body = await pdfBufferToMarkdown(rendered.pdf);
  if (body === undefined) {
    return { ok: false, reason: "empty" };
  }
  return { body, converter: "soffice-pdf-text", ok: true };
}

/** Normalizes an extension the way every entry point here expects it. */
export function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./u, "");
}

/** Runs the extractor that matches `extension` and returns Markdown for the sidecar. */
export async function convertKnowledgeSource(params: {
  buffer: Buffer;
  extension: string;
}): Promise<KnowledgeConversion> {
  const extension = normalizeExtension(params.extension);
  if (TEXT_EXTENSIONS.has(extension)) {
    const body = normalizeText(await decodeTextBuffer(params.buffer));
    return body.length > 0 ? { body, converter: "copy", ok: true } : { ok: false, reason: "empty" };
  }
  if (extension === "pdf") {
    const body = await pdfBufferToMarkdown(params.buffer);
    return body === undefined
      ? { ok: false, reason: "empty" }
      : { body, converter: "pdf-text", ok: true };
  }
  if (extension === "docx" || extension === "xlsx") {
    return await convertOoxml(params.buffer, extension);
  }
  if (HANGUL_EXTENSIONS.has(extension)) {
    return await convertHangul(params.buffer, extension);
  }
  if (SOFFICE_EXTENSIONS.has(extension)) {
    return await convertThroughSoffice(params.buffer, extension);
  }
  return { ok: false, reason: "conversion-failed" };
}
