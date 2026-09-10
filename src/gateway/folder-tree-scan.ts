// Walk the shared mount once and write down where the folders are.
//
// The tree screen used to ask the NAS on every expand. That is one `readdir` plus one
// `realpath` and one `stat` for every name in the directory, and these shares hold
// directories with thousands of files in them: measured 2026-09-09 on the delivery NAS,
// one such level cost 856 ms warm, against 5 ms for the same `readdir` when the entry
// types come back with the listing. On a two-core DS218+ serving the company's files at
// the same time, that is the difference people were reporting as "the folder tree is
// slow".
//
// So this walk does three things differently from the live listing:
//
//   - It asks for entry types with the listing (`withFileTypes`), and pays for `realpath`
//     only on the entries that are actually symbolic links. The escape check that keeps a
//     link from smuggling in another part of the filesystem is unchanged; it is just no
//     longer paid for by every ordinary file.
//   - It records folders only. File names are what changes hourly and what the tree never
//     draws.
//   - It keeps going where the NAS says no. Seven `보안폴더` on this delivery are closed to
//     the container by the NAS ACL itself (DEPLOY.md 11.4-1), and a walk that stopped
//     there would index nothing below the first one it met.
//
// The walk never widens anything. It records the same folders the live listing would have
// reported to a system administrator; who may see which of them is still decided per
// request by folder-access-policy.ts against the rule table.
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  beginFolderTreeScan,
  finishFolderTreeScan,
  pruneFolderTreeBranch,
  readFolderTreeNode,
  recordFolderTreeNodesScanned,
  recordFolderTreeNodesSeen,
  type FolderTreeNode,
} from "../state/folder-tree-store.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import { isExcludedFolderName } from "./folder-access-path.js";

const log = createSubsystemLogger("gateway/folder-tree");

/**
 * Directories read at once.
 *
 * Two, because the delivery NAS has two cores and is a file server first. The walk is
 * IO bound and finishes in well under a minute at this width; widening it would only
 * take the machine away from the people using it.
 */
export const FOLDER_TREE_DEFAULT_CONCURRENCY = 2;

/** Upper bound an operator may ask for. Past this the walk is competing with the NAS. */
export const FOLDER_TREE_MAX_CONCURRENCY = 8;

/** Folders one walk will record before it stops and says so. */
const FOLDER_TREE_MAX_FOLDERS = 200_000;

/** Depth one walk will descend. The deepest measured real path was 23 levels. */
const FOLDER_TREE_MAX_DEPTH = 40;

/** How long a claimed walk may be silent before another process takes the claim. */
const FOLDER_TREE_SCAN_STALE_MS = 2 * 60 * 60 * 1000;

export type FolderTreeScanSummary = {
  root: string;
  branchPath: string;
  /** False when another walk held the claim; nothing was read or written. */
  ran: boolean;
  folders: number;
  unreadable: number;
  removed: number;
  truncated: boolean;
  startedAt: number;
  durationMs: number;
};

export type FolderTreeScanOptions = {
  root: string;
  /** Root-relative branch to walk. `""` is the whole mount. */
  branchPath?: string;
  concurrency?: number;
  maxFolders?: number;
  maxDepth?: number;
  /** Called every `progressEvery` folders so a long walk is not silent. */
  onProgress?: (progress: { folders: number; elapsedMs: number; folderPath: string }) => void;
  progressEvery?: number;
  stateOptions?: OpenClawStateDatabaseOptions;
};

type PendingDirectory = { folderPath: string; absolutePath: string; depth: number };

function isInsideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * The stored path for one child.
 *
 * Normalized to NFC, because that is the form every rule is written in and the form the
 * Gateway hands back to a browser (folder-access-path.ts). Ten folders on this NAS are
 * stored decomposed, and a snapshot keyed on the decomposed form would never be found by
 * a lookup that had already normalized. The absolute path beside it keeps the bytes the
 * filesystem actually uses, so nothing here ever has to guess a name back.
 */
function joinFolderPath(parent: string, name: string): string {
  const joined = parent.length === 0 ? name : `${parent}/${name}`;
  return joined.normalize("NFC");
}

/**
 * The subdirectories of one directory, and whether it could be read at all.
 *
 * A name is a subdirectory when the listing says so. A symbolic link is resolved and
 * re-checked against the root, because that is the one case where a name in this share
 * can point outside it. Everything else costs one entry in the listing and nothing more.
 */
async function readSubdirectories(params: {
  root: string;
  directory: PendingDirectory;
}): Promise<{ readable: boolean; children: { name: string; absolutePath: string }[] }> {
  let entries;
  try {
    entries = await readdir(params.directory.absolutePath, { withFileTypes: true });
  } catch {
    // The NAS ACL closes seven folders to this container by design, and a folder can also
    // disappear between the parent listing and this read. Both are "nothing below here",
    // not a reason to abandon the walk.
    return { readable: false, children: [] };
  }
  const children: { name: string; absolutePath: string }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || isExcludedFolderName(entry.name)) {
      continue;
    }
    const childPath = path.join(params.directory.absolutePath, entry.name);
    if (entry.isDirectory()) {
      children.push({ name: entry.name, absolutePath: childPath });
      continue;
    }
    if (!entry.isSymbolicLink()) {
      continue;
    }
    try {
      const resolved = await realpath(childPath);
      if (!isInsideRoot(params.root, resolved)) {
        continue;
      }
      if ((await stat(resolved)).isDirectory()) {
        children.push({ name: entry.name, absolutePath: resolved });
      }
    } catch {
      // A link to nowhere is not a folder.
    }
  }
  children.sort((left, right) => left.name.localeCompare(right.name));
  return { readable: true, children };
}

/**
 * Walk one branch of the mount and replace what the snapshot holds for it.
 *
 * The claim is taken first, so a nightly cron and an operator pressing refresh cannot
 * both walk the same NAS at once. When the claim is refused this returns `ran: false`
 * and touches nothing.
 */
export async function scanFolderTree(
  options: FolderTreeScanOptions,
): Promise<FolderTreeScanSummary> {
  const branchPath = options.branchPath ?? "";
  const startedAt = Date.now();
  const stateOptions = options.stateOptions ?? {};
  const claimed = beginFolderTreeScan(
    {
      scopeRoot: options.root,
      branchPath,
      nowMs: startedAt,
      staleAfterMs: FOLDER_TREE_SCAN_STALE_MS,
    },
    stateOptions,
  );
  if (!claimed) {
    return {
      root: options.root,
      branchPath,
      ran: false,
      folders: 0,
      unreadable: 0,
      removed: 0,
      truncated: false,
      startedAt,
      durationMs: 0,
    };
  }
  const concurrency = Math.min(
    Math.max(options.concurrency ?? FOLDER_TREE_DEFAULT_CONCURRENCY, 1),
    FOLDER_TREE_MAX_CONCURRENCY,
  );
  const maxFolders = options.maxFolders ?? FOLDER_TREE_MAX_FOLDERS;
  const maxDepth = options.maxDepth ?? FOLDER_TREE_MAX_DEPTH;
  const progressEvery = options.progressEvery ?? 2000;
  // A branch is re-walked from the absolute path the last walk recorded, when there is
  // one. Rebuilding it from the normalized rule path would miss a folder whose real name
  // is stored decomposed, and answer "unreadable" for a folder that is right there.
  const branchNode =
    branchPath.length === 0
      ? undefined
      : readFolderTreeNode({ scopeRoot: options.root, folderPath: branchPath }, stateOptions);
  const branchAbsolute =
    branchPath.length === 0
      ? options.root
      : (branchNode?.absolutePath ?? path.join(options.root, ...branchPath.split("/")));
  const queue: PendingDirectory[] = [
    { folderPath: branchPath, absolutePath: branchAbsolute, depth: 0 },
  ];
  const seenPaths = new Set<string>([branchPath]);
  let folders = 0;
  let unreadable = 0;
  let truncated = false;
  let pendingSeen: FolderTreeNode[] = [];
  let pendingScanned: FolderTreeNode[] = [];

  const flush = (force: boolean): void => {
    if (pendingSeen.length >= 200 || (force && pendingSeen.length > 0)) {
      recordFolderTreeNodesSeen({ scopeRoot: options.root, nodes: pendingSeen }, stateOptions);
      pendingSeen = [];
    }
    if (pendingScanned.length >= 200 || (force && pendingScanned.length > 0)) {
      recordFolderTreeNodesScanned(
        { scopeRoot: options.root, nodes: pendingScanned },
        stateOptions,
      );
      pendingScanned = [];
    }
  };

  const takeOne = async (): Promise<boolean> => {
    const directory = queue.pop();
    if (!directory) {
      return false;
    }
    const { readable, children } = await readSubdirectories({ root: options.root, directory });
    const now = Date.now();
    if (!readable) {
      unreadable += 1;
    }
    pendingScanned.push({
      folderPath: directory.folderPath,
      parentPath:
        directory.folderPath.length === 0
          ? directory.folderPath
          : directory.folderPath.slice(0, Math.max(directory.folderPath.lastIndexOf("/"), 0)),
      name: path.basename(directory.absolutePath),
      absolutePath: directory.absolutePath,
      childCount: children.length,
      readable,
      childrenScannedAt: now,
      scannedAt: now,
    });
    for (const child of children) {
      const childPath = joinFolderPath(directory.folderPath, child.name);
      if (seenPaths.has(childPath)) {
        continue;
      }
      seenPaths.add(childPath);
      if (folders >= maxFolders) {
        truncated = true;
        continue;
      }
      folders += 1;
      pendingSeen.push({
        folderPath: childPath,
        parentPath: directory.folderPath,
        name: child.name,
        absolutePath: child.absolutePath,
        childCount: 0,
        readable: true,
        childrenScannedAt: 0,
        scannedAt: now,
      });
      if (directory.depth + 1 < maxDepth) {
        queue.push({
          folderPath: childPath,
          absolutePath: child.absolutePath,
          depth: directory.depth + 1,
        });
      } else {
        truncated = true;
      }
      if (folders % progressEvery === 0) {
        const elapsedMs = Date.now() - startedAt;
        options.onProgress?.({ folders, elapsedMs, folderPath: childPath });
        log.info("folder tree scan progress", { folders, elapsedMs, branchPath });
      }
    }
    flush(false);
    return true;
  };

  const worker = async (): Promise<void> => {
    while (await takeOne()) {
      // Each pass takes one directory; the loop ends when the queue is empty.
    }
  };
  // Whatever happens from here on, the claim has to be released. A walk that throws and
  // leaves the claim standing blocks every later walk for the two-hour staleness window,
  // and the next walk an operator asks for is the one that matters.
  let removed = 0;
  try {
    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      flush(true);
    }
    try {
      // Rows this walk never touched are folders that are gone. Their rules are handled
      // separately by the orphan screen, which is deliberate: a snapshot must never
      // delete an operator's rule on its own.
      removed = pruneFolderTreeBranch(
        { scopeRoot: options.root, branchPath, seenBefore: startedAt },
        stateOptions,
      );
    } catch (error) {
      // A stale row left behind is a folder that shows in the tree until the next walk.
      // That is a far smaller fault than failing a walk that already read the share.
      log.warn("folder tree prune failed", { branchPath, error: String(error) });
    }
  } finally {
    try {
      finishFolderTreeScan(
        {
          scopeRoot: options.root,
          nowMs: Date.now(),
          durationMs: Date.now() - startedAt,
          folderCount: folders,
          unreadableCount: unreadable,
          truncated,
        },
        stateOptions,
      );
    } catch (error) {
      // Never let the bookkeeping replace the real failure on its way out. The claim then
      // stands until the staleness window clears it, which is the backstop it is for.
      log.warn("folder tree scan claim not released", { branchPath, error: String(error) });
    }
  }
  const durationMs = Date.now() - startedAt;
  log.info("folder tree scan finished", {
    branchPath,
    durationMs,
    folders,
    removed,
    unreadable,
  });
  return {
    root: options.root,
    branchPath,
    ran: true,
    folders,
    unreadable,
    removed,
    truncated,
    startedAt,
    durationMs,
  };
}
