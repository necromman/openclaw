// Picks and runs the extractor for one source document.
//
// Nothing here is new machinery: the PDF reader, the OOXML reader and the LibreOffice
// bridge all already exist for the file preview pane. This module only decides which of
// them a given extension goes through and shapes the result as Markdown.
import { convertDocumentToPdf } from "../gateway/document-convert.js";
import { extractDocumentHtml } from "../gateway/document-extract-html.js";
import { pdfBufferToMarkdown } from "./convert-pdf.js";
import { documentHtmlToMarkdown } from "./html-markdown.js";
import type { KnowledgeConverterId, KnowledgeFailureReason } from "./types.js";

/** Extensions LibreOffice has to render before any text can be read out of them. */
const SOFFICE_EXTENSIONS = new Set(["pptx", "ppt", "doc", "xls", "odt", "ods", "odp", "rtf"]);
/** Extensions that are already text and only need decoding. */
const TEXT_EXTENSIONS = new Set(["md", "txt", "csv"]);

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
  if (SOFFICE_EXTENSIONS.has(extension)) {
    return await convertThroughSoffice(params.buffer, extension);
  }
  return { ok: false, reason: "conversion-failed" };
}
