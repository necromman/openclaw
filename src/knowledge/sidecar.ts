// Sidecar naming and frontmatter for the knowledge index.
//
// A sidecar is a Markdown file that stands in for one source document. The memory
// indexer only ever collects Markdown, so the sidecar is what gets indexed and what a
// citation points at; the frontmatter and the quoted first line are what carry the
// reader back to the real file on the share.
import path from "node:path";
import { KNOWLEDGE_SIDECAR_SUFFIX, type KnowledgeSidecarMeta } from "./types.js";

const FRONTMATTER_FENCE = "---";

/** Field order in the written frontmatter. Stable so a diff of two runs stays readable. */
const META_FIELDS = [
  ["source_path", "sourcePath"],
  ["source_relative", "sourceRelative"],
  ["source_mtime", "sourceMtime"],
  ["source_size", "sourceSize"],
  ["source_sha256", "sourceSha256"],
  ["converted_at", "convertedAt"],
  ["converter", "converter"],
] as const satisfies ReadonlyArray<readonly [string, keyof KnowledgeSidecarMeta]>;

/** Normalizes a relative path to POSIX separators without a leading "./". */
export function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/").replace(/^\.\//u, "");
}

/**
 * Rejects a relative path that would write outside the index root.
 *
 * The walker already refuses symlinks, but a name is checked again here because the
 * sidecar path is built by string concatenation and a single ".." segment would put the
 * write anywhere on the host.
 */
export function isSafeRelativePath(relativePath: string): boolean {
  const normalized = toPosixRelative(relativePath);
  if (normalized.length === 0 || normalized.startsWith("/")) {
    return false;
  }
  if (path.isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized)) {
    return false;
  }
  return normalized.split("/").every((segment) => segment !== "" && segment !== "..");
}

/**
 * Maps a source path to its sidecar path.
 *
 * The suffix is appended rather than replacing the original extension, so `notes.pdf`
 * and `notes.docx` in one folder stay two distinct sidecars instead of overwriting each
 * other. The cost is a doubled extension on Markdown sources (`README.md.md`), which is
 * the cheaper of the two problems.
 */
export function sidecarRelativePath(sourceRelativePath: string): string {
  return `${toPosixRelative(sourceRelativePath)}${KNOWLEDGE_SIDECAR_SUFFIX}`;
}

/** Inverse of {@link sidecarRelativePath}; returns undefined for a foreign file. */
export function sourceRelativePathFromSidecar(sidecarRelative: string): string | undefined {
  const normalized = toPosixRelative(sidecarRelative);
  if (!normalized.endsWith(KNOWLEDGE_SIDECAR_SUFFIX)) {
    return undefined;
  }
  const source = normalized.slice(0, -KNOWLEDGE_SIDECAR_SUFFIX.length);
  return source.length > 0 ? source : undefined;
}

function serializeValue(value: string | number): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

/** Renders the frontmatter block, including both fences and the trailing newline. */
export function renderFrontmatter(meta: KnowledgeSidecarMeta): string {
  const lines = [FRONTMATTER_FENCE];
  for (const [key, field] of META_FIELDS) {
    lines.push(`${key}: ${serializeValue(meta[field])}`);
  }
  lines.push(FRONTMATTER_FENCE);
  return `${lines.join("\n")}\n`;
}

/**
 * Renders a complete sidecar.
 *
 * The quoted origin line sits directly under the frontmatter on purpose. A memory
 * citation returns a line range from the top of the matched section, and a reader who
 * follows one needs the real path in the same view; the quote puts it in the first lines
 * of every snippet without touching the citation decorator.
 */
export function renderSidecar(meta: KnowledgeSidecarMeta, body: string): string {
  const trimmed = body.replace(/\s+$/u, "");
  return `${renderFrontmatter(meta)}\n> 원본: ${meta.sourcePath}\n\n${trimmed}\n`;
}

/**
 * Rewrites only the frontmatter of an existing sidecar.
 *
 * Used when the source bytes hashed identical but its timestamp moved, which is what a
 * copy, a restore, or a touch looks like. Refreshing the recorded timestamp lets the next
 * run take the cheap size-and-time path instead of hashing the file forever.
 */
export function replaceSidecarFrontmatter(
  content: string,
  meta: KnowledgeSidecarMeta,
): string | undefined {
  if (!content.startsWith(`${FRONTMATTER_FENCE}\n`)) {
    return undefined;
  }
  const end = content.indexOf(`\n${FRONTMATTER_FENCE}\n`, FRONTMATTER_FENCE.length);
  if (end < 0) {
    return undefined;
  }
  const rest = content.slice(end + FRONTMATTER_FENCE.length + 2);
  return `${renderFrontmatter(meta)}${rest}`;
}

function parseValue(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Reads back the frontmatter this module wrote.
 *
 * Only the fields the incremental comparison needs are typed; a sidecar written by an
 * older build with a missing field simply reconverts.
 */
export function parseFrontmatter(content: string): Partial<KnowledgeSidecarMeta> | undefined {
  if (!content.startsWith(`${FRONTMATTER_FENCE}\n`)) {
    return undefined;
  }
  const end = content.indexOf(`\n${FRONTMATTER_FENCE}\n`, FRONTMATTER_FENCE.length);
  if (end < 0) {
    return undefined;
  }
  const block = content.slice(FRONTMATTER_FENCE.length + 1, end);
  const found: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const value = parseValue(line.slice(separator + 1));
    if (value !== undefined) {
      found[line.slice(0, separator).trim()] = value;
    }
  }
  const size = Number.parseInt(found.source_size ?? "", 10);
  return {
    ...(found.source_path === undefined ? {} : { sourcePath: found.source_path }),
    ...(found.source_relative === undefined ? {} : { sourceRelative: found.source_relative }),
    ...(found.source_mtime === undefined ? {} : { sourceMtime: found.source_mtime }),
    ...(Number.isSafeInteger(size) && size >= 0 ? { sourceSize: size } : {}),
    ...(found.source_sha256 === undefined ? {} : { sourceSha256: found.source_sha256 }),
    ...(found.converted_at === undefined ? {} : { convertedAt: found.converted_at }),
    // SAFETY: the value round-trips a union this module wrote; an unknown string only
    // makes the incremental comparison miss and reconvert, which is the safe direction.
    ...(found.converter === undefined
      ? {}
      : { converter: found.converter as KnowledgeSidecarMeta["converter"] }),
  };
}
