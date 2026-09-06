// Control UI module classifies workspace paths the Gateway can turn into a
// document preview. The request side (chat-session-workspace) and the preview
// element resolve the same extension table, so the two cannot drift.

export type DocumentPreviewKind = "pdf" | "word" | "sheet" | "slides" | "hangul" | null;

const DOCUMENT_PREVIEW_KIND_BY_EXTENSION: Record<string, Exclude<DocumentPreviewKind, null>> = {
  doc: "word",
  docx: "word",
  hwp: "hangul",
  hwpx: "hangul",
  odp: "slides",
  ods: "sheet",
  odt: "word",
  pdf: "pdf",
  ppt: "slides",
  pptx: "slides",
  rtf: "word",
  xls: "sheet",
  xlsx: "sheet",
};

// Windows paths reach the Control UI verbatim, so both separators split segments.
const PATH_SEPARATOR_RE = /[\\/]/;

/** Presentation family for a workspace path, or null when it is not a document. */
export function documentPreviewKindForPath(path: string): DocumentPreviewKind {
  const segments = path.split(PATH_SEPARATOR_RE);
  const name = (segments[segments.length - 1] ?? path).toLowerCase();
  // Index 0 means a dotfile (".pdf"), which carries a leading dot rather than an
  // extension, so it never resolves to a document kind.
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  return DOCUMENT_PREVIEW_KIND_BY_EXTENSION[extension] ?? null;
}

/** True when the Gateway should be asked for a rendered document preview. */
export function isDocumentPreviewPath(path: string): boolean {
  const kind = documentPreviewKindForPath(path);
  return kind !== null && kind !== "hangul";
}

/** Hangul word processor files carry no converter yet; they only get a notice. */
export function isHangulDocumentPath(path: string): boolean {
  return documentPreviewKindForPath(path) === "hangul";
}
