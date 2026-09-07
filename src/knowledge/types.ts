// Shared contracts for the knowledge sidecar index (`openclaw knowledge sync`).

/** Which extractor produced a sidecar body. Recorded in frontmatter so a run can be traced. */
export const KNOWLEDGE_CONVERTER_IDS = [
  "pdf-text",
  "docx-html",
  "xlsx-html",
  "soffice-pdf-text",
  "copy",
] as const;

export type KnowledgeConverterId = (typeof KNOWLEDGE_CONVERTER_IDS)[number];

/** Why a source file produced no sidecar. */
export type KnowledgeIgnoreReason =
  | "extension"
  | "too-large"
  | "symlink"
  | "outside-root"
  | "empty";

/** Why a conversion attempt failed. */
export type KnowledgeFailureReason =
  | "converter-unavailable"
  | "conversion-failed"
  | "read-failed"
  | "write-failed";

/** What happened to one source file (or one orphan sidecar) during a sync. */
export type KnowledgeSyncAction =
  | "created"
  | "updated"
  | "skipped"
  | "deleted"
  | "ignored"
  | "failed";

/** One row of the run report. */
export type KnowledgeSyncEntry = {
  action: KnowledgeSyncAction;
  /** Source path relative to `--source`, in POSIX form. Absent for orphan sidecars. */
  relativePath: string;
  /** Sidecar path relative to `--out`, in POSIX form. */
  sidecarPath: string;
  converter?: KnowledgeConverterId;
  reason?: KnowledgeIgnoreReason | KnowledgeFailureReason;
  sourceBytes?: number;
  sidecarBytes?: number;
};

/** Aggregate counts, one per action. */
export type KnowledgeSyncCounts = Record<KnowledgeSyncAction, number>;

/** The full run report. `--json` prints exactly this object. */
export type KnowledgeSyncSummary = {
  source: string;
  out: string;
  dryRun: boolean;
  include: readonly string[];
  maxBytes: number;
  concurrency: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  counts: KnowledgeSyncCounts;
  entries: readonly KnowledgeSyncEntry[];
  /** True when at least one source was skipped because no converter was installed. */
  converterMissing: boolean;
};

/** Frontmatter written at the top of every sidecar. */
export type KnowledgeSidecarMeta = {
  sourcePath: string;
  sourceRelative: string;
  sourceMtime: string;
  sourceSize: number;
  sourceSha256: string;
  convertedAt: string;
  converter: KnowledgeConverterId;
};

/** Source extensions the sync understands, and how each one is read. */
export const KNOWLEDGE_CONVERTIBLE_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",
  "ppt",
  "odt",
  "ods",
  "odp",
  "rtf",
  "csv",
  "md",
  "txt",
] as const;

/** Default `--include` set: the four delivery formats plus the two text formats. */
export const KNOWLEDGE_DEFAULT_INCLUDE = ["pdf", "docx", "xlsx", "pptx", "md", "txt"] as const;

/** Default `--max-bytes`: 20 MiB, matching the document preview ceiling. */
export const KNOWLEDGE_DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** Default `--concurrency`: LibreOffice forks a heavy process per conversion. */
export const KNOWLEDGE_DEFAULT_CONCURRENCY = 2;

/** Hard ceiling for `--concurrency`, so a typo cannot fork a hundred converters. */
export const KNOWLEDGE_MAX_CONCURRENCY = 8;

/** Hard ceiling for `--max-bytes`: the converter itself refuses larger output. */
export const KNOWLEDGE_MAX_BYTES_LIMIT = 40 * 1024 * 1024;

/** Every sidecar carries this suffix on top of the source name, so names never collide. */
export const KNOWLEDGE_SIDECAR_SUFFIX = ".md";

/** Returns a zeroed count record. */
export function emptyKnowledgeSyncCounts(): KnowledgeSyncCounts {
  return { created: 0, deleted: 0, failed: 0, ignored: 0, skipped: 0, updated: 0 };
}
