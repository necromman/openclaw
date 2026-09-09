// Gateway session files module implements the renderable document preview lane.
import path from "node:path";
import type { SessionFileEntry } from "../../../packages/gateway-protocol/src/index.js";
import { convertDocumentToPdf } from "../document-convert.js";
import { extractDocumentHtml } from "../document-extract-html.js";
import { readWorkspaceFile } from "./workspace-fs.js";

/**
 * Document previews carry whole files, not the 256 KiB inline slice, so they get
 * their own much larger cap. Anything past it is reported instead of shipped.
 */
export const MAX_DOCUMENT_PREVIEW_BYTES = 20 * 1024 * 1024;

/** Extensions the document lane knows how to render or convert. */
const DOCUMENT_PREVIEW_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "xls",
  "xlsx",
  "ods",
  "ppt",
  "pptx",
  "odp",
  "hwp",
  "hwpx",
]);

/**
 * Hangul word processor files never go through LibreOffice: its bundled filter only
 * understands the pre-2005 format and exits 0 without writing a PDF for everything else.
 * They go straight to the built-in reader, which returns HTML rather than a PDF.
 */
const HANGUL_EXTENSIONS = new Set(["hwp", "hwpx"]);

function documentExtension(name: string): string {
  return path.extname(name).replace(/^\./u, "").toLowerCase();
}

/**
 * Drops the inline preview fields before the document lane writes its own.
 * The hash matters most: it is the sessions.files.set CAS token, and a document
 * payload is not the file's own bytes, so leaving it would invite a bad write.
 */
function resetPreviewFields(entry: SessionFileEntry): void {
  delete entry.content;
  delete entry.contentEncoding;
  delete entry.hash;
  delete entry.mimeType;
  delete entry.document;
  delete entry.documentError;
}

function markUnsupported(
  entry: SessionFileEntry,
  documentError?: SessionFileEntry["documentError"],
): void {
  resetPreviewFields(entry);
  entry.previewKind = "unsupported";
  if (documentError) {
    entry.documentError = documentError;
  }
}

function applyDocumentPayload(
  entry: SessionFileEntry,
  payload: {
    content: string;
    contentEncoding: NonNullable<SessionFileEntry["contentEncoding"]>;
    mimeType: string;
    document: NonNullable<SessionFileEntry["document"]>;
  },
): void {
  resetPreviewFields(entry);
  entry.previewKind = "document";
  entry.contentEncoding = payload.contentEncoding;
  entry.content = payload.content;
  entry.mimeType = payload.mimeType;
  entry.document = payload.document;
}

/** Fills one session file entry with a renderable document payload, in place. */
export async function buildSessionFileDocumentPreview(params: {
  root: string;
  browserPath: string;
  entry: SessionFileEntry;
  convert?: boolean;
}): Promise<void> {
  const entry = params.entry;
  const extension = documentExtension(entry.name);
  if (!DOCUMENT_PREVIEW_EXTENSIONS.has(extension)) {
    markUnsupported(entry, "unsupported-format");
    return;
  }
  if (entry.size !== undefined && entry.size > MAX_DOCUMENT_PREVIEW_BYTES) {
    markUnsupported(entry, "too-large");
    return;
  }
  const read = await readWorkspaceFile(params.root, params.browserPath, {
    maxBytes: MAX_DOCUMENT_PREVIEW_BYTES,
  });
  if (read === "too-large") {
    markUnsupported(entry, "too-large");
    return;
  }
  if (!read) {
    // The file vanished or failed the fs-safe checks between the two reads.
    markUnsupported(entry);
    return;
  }
  if (extension === "pdf") {
    applyDocumentPayload(entry, {
      content: read.buffer.toString("base64"),
      contentEncoding: "base64",
      document: { converted: false, format: "pdf", sourceFormat: "pdf" },
      mimeType: "application/pdf",
    });
    return;
  }
  if (params.convert !== false && !HANGUL_EXTENSIONS.has(extension)) {
    const converted = await convertDocumentToPdf({
      buffer: read.buffer,
      sourceExtension: extension,
    });
    if (converted.ok) {
      applyDocumentPayload(entry, {
        content: converted.pdf.toString("base64"),
        contentEncoding: "base64",
        document: {
          converted: true,
          converter: converted.converter,
          format: "pdf",
          sourceFormat: extension,
        },
        mimeType: "application/pdf",
      });
      return;
    }
    // A converter that ran and failed is a real conversion failure; only a
    // missing converter falls through to the built-in extraction below.
    if (converted.reason !== "converter-unavailable") {
      markUnsupported(entry, "conversion-failed");
      return;
    }
  }
  const extracted = await extractDocumentHtml({
    buffer: read.buffer,
    sourceExtension: extension,
  });
  if (extracted.ok) {
    applyDocumentPayload(entry, {
      content: extracted.html,
      contentEncoding: "utf8",
      document: { converted: true, converter: "builtin", format: "html", sourceFormat: extension },
      mimeType: "text/html",
    });
    return;
  }
  // A Hangul document has no converter behind the built-in reader, so a failure here is
  // the document itself (password, distribution copy, or the pre-2005 format), not a
  // missing tool the operator could install.
  markUnsupported(
    entry,
    HANGUL_EXTENSIONS.has(extension) ? "conversion-failed" : "converter-unavailable",
  );
}
