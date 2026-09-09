/** Operator CLI for the folder tree snapshot that makes the share browsable at speed. */
import { sanitizeTerminalText } from "../../packages/terminal-core/src/safe-text.js";
import { resolveDepartmentFolderRoot } from "../gateway/department-folder-listing.js";
import { normalizeFolderRulePath } from "../gateway/folder-access-path.js";
import { FOLDER_TREE_MAX_CONCURRENCY, scanFolderTree } from "../gateway/folder-tree-scan.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { clearFolderTreeIndex, readFolderTreeScan } from "../state/folder-tree-store.js";

export type FoldersScanCommandOptions = {
  root?: string;
  path?: string;
  concurrency?: string;
  quiet?: boolean;
  json?: boolean;
};

export type FoldersStatusCommandOptions = {
  root?: string;
  json?: boolean;
};

export type FoldersClearCommandOptions = {
  root?: string;
};

function parseConcurrency(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > FOLDER_TREE_MAX_CONCURRENCY) {
    throw new Error(
      `--concurrency must be an integer between 1 and ${FOLDER_TREE_MAX_CONCURRENCY}.`,
    );
  }
  return parsed;
}

async function resolveRoot(override: string | undefined): Promise<string> {
  const trimmed = override?.trim();
  const resolved = await resolveDepartmentFolderRoot(trimmed && trimmed.length > 0 ? trimmed : "");
  if (!resolved.available) {
    throw new Error(
      `The shared mount is not present here (${resolved.root}). Nothing was read or written.`,
    );
  }
  return resolved.root;
}

/**
 * `openclaw folders scan` - walk the share and store where its folders are.
 *
 * This is the command the nightly cron entry runs. It talks to the state database and the
 * filesystem only, never to the Gateway over RPC, which is why it still works in the
 * ix-auth delivery where an unauthenticated CLI cannot call a Gateway method
 * (DEPLOY.md 12.3). The Gateway reads the same rows the moment they are written.
 */
export async function foldersScanCommand(
  options: FoldersScanCommandOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const root = await resolveRoot(options.root);
  const branchPath = normalizeFolderRulePath(options.path, root);
  if (branchPath === undefined) {
    throw new Error("--path must name a folder inside the shared mount.");
  }
  const concurrency = parseConcurrency(options.concurrency);
  const summary = await scanFolderTree({
    root,
    branchPath,
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(options.quiet || options.json
      ? {}
      : {
          onProgress: ({ folders, elapsedMs }) => {
            runtime.log(`scanned ${folders} folders in ${elapsedMs}ms`);
          },
        }),
  });
  if (options.json) {
    writeRuntimeJson(runtime, summary);
    return;
  }
  if (!summary.ran) {
    runtime.log("another scan is already running; this run did nothing");
    return;
  }
  runtime.log(
    [
      `root=${sanitizeTerminalText(summary.root)}`,
      `branch=${sanitizeTerminalText(summary.branchPath || "(all)")}`,
      `folders=${summary.folders}`,
      `unreadable=${summary.unreadable}`,
      `removed=${summary.removed}`,
      `truncated=${summary.truncated}`,
      `(${summary.durationMs}ms)`,
    ].join("  "),
  );
}

/** `openclaw folders status` - when the snapshot was last written, and what it holds. */
export async function foldersStatusCommand(
  options: FoldersStatusCommandOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const root = await resolveRoot(options.root);
  const scan = readFolderTreeScan(root);
  if (options.json) {
    writeRuntimeJson(runtime, { root, ...(scan ? { scan } : {}) });
    return;
  }
  if (!scan) {
    runtime.log(`root=${sanitizeTerminalText(root)}  no scan has been recorded`);
    return;
  }
  runtime.log(
    [
      `root=${sanitizeTerminalText(root)}`,
      `branch=${sanitizeTerminalText(scan.branchPath || "(all)")}`,
      scan.finishedAt === 0
        ? `running since ${new Date(scan.startedAt).toISOString()}`
        : `finished ${new Date(scan.finishedAt).toISOString()}`,
      `folders=${scan.folderCount}`,
      `unreadable=${scan.unreadableCount}`,
      `(${scan.durationMs}ms)`,
    ].join("  "),
  );
}

/** `openclaw folders clear` - forget the snapshot; the tree reads the NAS again. */
export async function foldersClearCommand(
  options: FoldersClearCommandOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const root = await resolveRoot(options.root);
  clearFolderTreeIndex(root);
  runtime.log(`cleared the folder snapshot for ${sanitizeTerminalText(root)}`);
}
