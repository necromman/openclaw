// Runs one `openclaw knowledge sync`: share in, Markdown sidecars out.
//
// The index folder is host local by design. The share is mounted read only and stays
// that way; everything this module writes lands under `--out`, which is what an agent's
// `memory.search.extraPaths` points at.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pMap from "p-map";
import { convertKnowledgeSource, type KnowledgeConversion } from "./convert.js";
import { prepareKnowledgeFolderFilter } from "./folder-rule-filter.js";
import {
  assertDisjointRoots,
  findOrphanSidecars,
  type KnowledgeCandidate,
  scanKnowledgeSource,
} from "./plan.js";
import {
  parseFrontmatter,
  renderSidecar,
  replaceSidecarFrontmatter,
  toPosixRelative,
} from "./sidecar.js";
import {
  emptyKnowledgeSyncCounts,
  KNOWLEDGE_DEFAULT_CONCURRENCY,
  KNOWLEDGE_DEFAULT_INCLUDE,
  KNOWLEDGE_DEFAULT_MAX_BYTES,
  KNOWLEDGE_MAX_BYTES_LIMIT,
  KNOWLEDGE_MAX_CONCURRENCY,
  type KnowledgeSidecarMeta,
  type KnowledgeSyncEntry,
  type KnowledgeSyncSummary,
} from "./types.js";

export type KnowledgeSyncOptions = {
  source: string;
  out: string;
  include?: readonly string[];
  maxBytes?: number;
  concurrency?: number;
  dryRun?: boolean;
  /**
   * Whether the folder access rules narrow this run. Default true.
   *
   * `--no-folder-rules` turns it off for a one-off run against a share the rules do not
   * describe. The rules are inert anyway until at least one is written, so leaving this
   * on costs nothing in a deployment that is not using the feature.
   */
  respectFolderRules?: boolean;
  /** Injected in tests so a summary can be asserted without a moving clock. */
  now?: () => Date;
};

function clampConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return KNOWLEDGE_DEFAULT_CONCURRENCY;
  }
  return Math.min(KNOWLEDGE_MAX_CONCURRENCY, Math.max(1, Math.trunc(value)));
}

function clampMaxBytes(value: number | undefined): number {
  if (value === undefined) {
    return KNOWLEDGE_DEFAULT_MAX_BYTES;
  }
  return Math.min(KNOWLEDGE_MAX_BYTES_LIMIT, Math.max(1, Math.trunc(value)));
}

/** Normalizes an `--include` list; an empty or absent list falls back to the default. */
function resolveIncludeSet(include: readonly string[] | undefined): Set<string> {
  const values = (include ?? KNOWLEDGE_DEFAULT_INCLUDE)
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim().toLowerCase().replace(/^\./u, ""))
    .filter((entry) => entry.length > 0);
  return new Set(values.length > 0 ? values : KNOWLEDGE_DEFAULT_INCLUDE);
}

async function readSidecar(absolutePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

async function writeSidecar(absolutePath: string, content: string): Promise<number> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
  return Buffer.byteLength(content, "utf8");
}

type SyncContext = {
  source: string;
  out: string;
  dryRun: boolean;
  now: () => Date;
};

/**
 * Decides and performs the work for one source file.
 *
 * The comparison runs cheapest first: recorded size and timestamp, then the digest. The
 * digest branch exists because a restore from backup rewrites timestamps without
 * changing a byte, and reconverting a whole share on those grounds is the difference
 * between a quiet cron job and one that pins a core every half hour.
 */
async function syncOne(
  context: SyncContext,
  candidate: KnowledgeCandidate,
): Promise<KnowledgeSyncEntry> {
  const sidecarAbsolute = path.join(context.out, candidate.sidecarPath);
  const existing = await readSidecar(sidecarAbsolute);
  const previous = existing === undefined ? undefined : parseFrontmatter(existing);
  const base = {
    relativePath: candidate.relativePath,
    sidecarPath: candidate.sidecarPath,
    sourceBytes: candidate.size,
  };
  if (
    previous?.sourceSize === candidate.size &&
    previous.sourceMtime === candidate.mtime &&
    previous.sourcePath === candidate.absolutePath &&
    previous.sourceSha256 !== undefined
  ) {
    return {
      ...base,
      action: "skipped",
      ...(previous.converter ? { converter: previous.converter } : {}),
    };
  }
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(candidate.absolutePath);
  } catch {
    return { ...base, action: "failed", reason: "read-failed" };
  }
  const digest = createHash("sha256").update(buffer).digest("hex");
  const unchanged = previous?.sourceSha256 === digest && existing !== undefined;
  const meta = (converter: KnowledgeSidecarMeta["converter"]): KnowledgeSidecarMeta => ({
    convertedAt: context.now().toISOString(),
    converter,
    sourceMtime: candidate.mtime,
    sourcePath: candidate.absolutePath,
    sourceRelative: candidate.relativePath,
    sourceSha256: digest,
    sourceSize: candidate.size,
  });
  if (unchanged) {
    const refreshed =
      previous.converter === undefined
        ? undefined
        : replaceSidecarFrontmatter(existing, {
            ...meta(previous.converter),
            convertedAt: previous.convertedAt ?? context.now().toISOString(),
          });
    if (refreshed !== undefined && !context.dryRun) {
      try {
        await writeSidecar(sidecarAbsolute, refreshed);
      } catch {
        return { ...base, action: "failed", reason: "write-failed" };
      }
    }
    return {
      ...base,
      action: "skipped",
      ...(previous.converter ? { converter: previous.converter } : {}),
    };
  }
  const action = existing === undefined ? "created" : "updated";
  if (context.dryRun) {
    return { ...base, action };
  }
  // Every converter failure is one file's failure. A converter that throws instead of
  // answering used to end the run where it stood, which on a share of forty thousand
  // files means the index stops at whatever document is unusual that day.
  let converted: KnowledgeConversion;
  try {
    converted = await convertKnowledgeSource({
      buffer,
      extension: candidate.extension,
    });
  } catch {
    converted = { ok: false, reason: "conversion-failed" };
  }
  if (!converted.ok) {
    return {
      ...base,
      action: converted.reason === "empty" ? "ignored" : "failed",
      reason: converted.reason,
    };
  }
  const content = renderSidecar(meta(converted.converter), converted.body);
  try {
    const sidecarBytes = await writeSidecar(sidecarAbsolute, content);
    return { ...base, action, converter: converted.converter, sidecarBytes };
  } catch {
    return { ...base, action: "failed", reason: "write-failed" };
  }
}

/** Deletes one orphan sidecar and prunes the directories it emptied. */
async function removeOrphan(out: string, relativePath: string): Promise<void> {
  const absolute = path.join(out, relativePath);
  await fs.rm(absolute, { force: true });
  let directory = path.dirname(absolute);
  while (directory !== out) {
    const inside = path.relative(out, directory);
    if (inside.length === 0 || inside.startsWith("..") || path.isAbsolute(inside)) {
      return;
    }
    try {
      await fs.rmdir(directory);
    } catch {
      return;
    }
    directory = path.dirname(directory);
  }
}

/**
 * Converts every eligible document under `--source` into a Markdown sidecar under
 * `--out`, updating only what changed and removing sidecars whose source is gone.
 */
export async function syncKnowledgeIndex(
  options: KnowledgeSyncOptions,
): Promise<KnowledgeSyncSummary> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const source = path.resolve(options.source);
  const out = path.resolve(options.out);
  assertDisjointRoots(source, out);
  const stat = await fs.stat(source).catch(() => undefined);
  if (!stat?.isDirectory()) {
    throw new Error(`--source is not a directory: ${source}`);
  }
  const include = resolveIncludeSet(options.include);
  const maxBytes = clampMaxBytes(options.maxBytes);
  const concurrency = clampConcurrency(options.concurrency);
  const dryRun = options.dryRun === true;
  if (!dryRun) {
    await fs.mkdir(out, { recursive: true });
  }
  const folderFilter =
    options.respectFolderRules === false
      ? undefined
      : await prepareKnowledgeFolderFilter({ source });
  // A source folder that is itself hidden from everyone indexes nothing, and the orphan
  // pass below then takes back whatever an earlier run wrote from it.
  const sourceHidden = folderFilter !== undefined && !folderFilter.allows("");
  const scan = sourceHidden
    ? {
        candidates: [],
        ignored: [{ reason: "folder-hidden" as const, relativePath: "", sidecarPath: "" }],
        known: new Set<string>(),
      }
    : await scanKnowledgeSource({
        include,
        maxBytes,
        source,
        ...(folderFilter ? { allowDirectory: folderFilter.allows } : {}),
      });
  const context: SyncContext = { dryRun, now, out, source };
  const converted = await pMap(scan.candidates, (candidate) => syncOne(context, candidate), {
    concurrency,
  });
  const entries: KnowledgeSyncEntry[] = [
    ...converted,
    ...scan.ignored.map((ignored) => ({
      action: "ignored" as const,
      reason: ignored.reason,
      relativePath: ignored.relativePath,
      sidecarPath: ignored.sidecarPath,
      ...(ignored.size === undefined ? {} : { sourceBytes: ignored.size }),
    })),
  ];
  const orphans = await findOrphanSidecars({ known: scan.known, out });
  for (const orphan of orphans) {
    if (!dryRun) {
      await removeOrphan(out, orphan);
    }
    entries.push({
      action: "deleted",
      relativePath: toPosixRelative(orphan).replace(/\.md$/u, ""),
      sidecarPath: orphan,
    });
  }
  const counts = emptyKnowledgeSyncCounts();
  for (const entry of entries) {
    counts[entry.action] += 1;
  }
  const finishedAt = now();
  return {
    concurrency,
    converterMissing: entries.some((entry) => entry.reason === "converter-unavailable"),
    folderRulesApplied: folderFilter !== undefined,
    counts,
    dryRun,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    entries,
    finishedAt: finishedAt.toISOString(),
    include: [...include].toSorted(),
    maxBytes,
    out,
    source,
    startedAt: startedAt.toISOString(),
  };
}
