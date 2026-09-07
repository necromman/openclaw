// Scans the source share and the index folder, and decides what each file is.
//
// The scan is separated from the conversion so the decision table stays readable and so
// `--dry-run` can run the whole decision without spawning a single converter.
import fs from "node:fs/promises";
import path from "node:path";
import { walkDirectory } from "../infra/fs-safe.js";
import { normalizeExtension } from "./convert.js";
import {
  isSafeRelativePath,
  sidecarRelativePath,
  sourceRelativePathFromSidecar,
  toPosixRelative,
} from "./sidecar.js";
import type { KnowledgeIgnoreReason } from "./types.js";

/** A source file that will be converted. */
export type KnowledgeCandidate = {
  relativePath: string;
  sidecarPath: string;
  absolutePath: string;
  extension: string;
  size: number;
  mtime: string;
};

/** A source file that will not be converted, and why. */
export type KnowledgeIgnored = {
  relativePath: string;
  sidecarPath: string;
  reason: KnowledgeIgnoreReason;
  size?: number;
};

export type KnowledgeScan = {
  candidates: KnowledgeCandidate[];
  ignored: KnowledgeIgnored[];
  /** Sidecar paths for every source file found, eligible or not. */
  known: Set<string>;
};

/**
 * Refuses a source and index pair that overlap.
 *
 * Writing the index inside the share would both break the "never write to the NAS" rule
 * and feed the next run its own output. Reading the share out of the index is the same
 * loop seen from the other end.
 */
export function assertDisjointRoots(source: string, out: string): void {
  const left = path.resolve(source);
  const right = path.resolve(out);
  if (left === right) {
    throw new Error("--source and --out must be different directories.");
  }
  const within = (parent: string, child: string) =>
    !path.relative(parent, child).startsWith("..") &&
    !path.isAbsolute(path.relative(parent, child));
  if (within(left, right)) {
    throw new Error("--out must not be inside --source; the index is never written to the share.");
  }
  if (within(right, left)) {
    throw new Error("--source must not be inside --out.");
  }
}

function isoMtime(mtimeMs: number): string {
  return new Date(Math.trunc(mtimeMs)).toISOString();
}

async function classify(params: {
  absolutePath: string;
  relativePath: string;
  include: ReadonlySet<string>;
  maxBytes: number;
}): Promise<KnowledgeCandidate | KnowledgeIgnored> {
  const sidecarPath = sidecarRelativePath(params.relativePath);
  const extension = normalizeExtension(path.extname(params.relativePath));
  if (!params.include.has(extension)) {
    return { reason: "extension", relativePath: params.relativePath, sidecarPath };
  }
  const stat = await fs.stat(params.absolutePath);
  if (stat.size === 0) {
    return { reason: "empty", relativePath: params.relativePath, sidecarPath, size: 0 };
  }
  if (stat.size > params.maxBytes) {
    return {
      reason: "too-large",
      relativePath: params.relativePath,
      sidecarPath,
      size: stat.size,
    };
  }
  return {
    absolutePath: params.absolutePath,
    extension,
    mtime: isoMtime(stat.mtimeMs),
    relativePath: params.relativePath,
    sidecarPath,
    size: stat.size,
  };
}

/** Walks the share once and sorts every file into "convert this" or "leave this". */
export async function scanKnowledgeSource(params: {
  source: string;
  include: ReadonlySet<string>;
  maxBytes: number;
}): Promise<KnowledgeScan> {
  const walked = await walkDirectory(params.source, {
    descend: (entry) => entry.kind === "directory",
    // "include" rather than "skip" so a symlink is reported as a deliberate omission
    // instead of vanishing. Only real files are ever read, and `descend` above keeps the
    // walk from following a linked directory out of the share.
    include: (entry) => entry.kind !== "directory",
    symlinks: "include",
  });
  const scan: KnowledgeScan = { candidates: [], ignored: [], known: new Set() };
  for (const entry of walked.entries) {
    const relativePath = toPosixRelative(entry.relativePath);
    const sidecarPath = sidecarRelativePath(relativePath);
    if (!isSafeRelativePath(relativePath)) {
      scan.ignored.push({ reason: "outside-root", relativePath, sidecarPath });
      continue;
    }
    scan.known.add(sidecarPath);
    if (entry.kind !== "file") {
      scan.ignored.push({ reason: "symlink", relativePath, sidecarPath });
      continue;
    }
    const classified = await classify({
      absolutePath: entry.path,
      include: params.include,
      maxBytes: params.maxBytes,
      relativePath,
    });
    if ("reason" in classified) {
      scan.ignored.push(classified);
    } else {
      scan.candidates.push(classified);
    }
  }
  scan.candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  scan.ignored.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return scan;
}

/**
 * Lists sidecars in the index whose source no longer exists.
 *
 * Only files this tool wrote are considered: a sidecar has to end in the suffix and its
 * content has to start with a frontmatter fence. An operator's own notes dropped into
 * the index folder are left alone.
 */
export async function findOrphanSidecars(params: {
  out: string;
  known: ReadonlySet<string>;
}): Promise<string[]> {
  let walked: Awaited<ReturnType<typeof walkDirectory>>;
  try {
    walked = await walkDirectory(params.out, {
      descend: (entry) => entry.kind === "directory",
      include: (entry) => entry.kind === "file",
      symlinks: "skip",
    });
  } catch {
    return [];
  }
  const orphans: string[] = [];
  for (const entry of walked.entries) {
    const relativePath = toPosixRelative(entry.relativePath);
    if (!isSafeRelativePath(relativePath) || params.known.has(relativePath)) {
      continue;
    }
    if (sourceRelativePathFromSidecar(relativePath) === undefined) {
      continue;
    }
    let head: string;
    try {
      const handle = await fs.open(entry.path, "r");
      try {
        const buffer = Buffer.alloc(4);
        await handle.read(buffer, 0, 4, 0);
        head = buffer.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      continue;
    }
    if (head === "---\n" || head === "---\r") {
      orphans.push(relativePath);
    }
  }
  return orphans.toSorted((left, right) => left.localeCompare(right));
}
