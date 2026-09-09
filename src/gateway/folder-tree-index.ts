// Answer "what is under this folder" from the snapshot when there is one.
//
// The tree screen asks for one level at a time. This module decides where that level
// comes from: the snapshot the walk wrote, or the NAS itself. The snapshot answers in
// one indexed SQLite read; the NAS answers in a `readdir` plus a `stat` per name, which
// on the delivery share is the difference between a click that lands and a click that
// waits (measured 2026-09-09: 856 ms for one directory holding 3,127 entries).
//
// The fallback is not a nicety. A deployment that has never run the walk, a folder the
// walk has not reached yet, a share mounted this morning: all of them must still draw a
// tree, and they do, exactly as they did before the snapshot existed. The snapshot makes
// the screen fast; it is never what makes it work.
//
// Nothing here filters. The rows are the folders a system administrator would see, and
// the permission verdict is applied afterwards by the caller, per request, from the rule
// table. Reversing that order would freeze yesterday's verdicts into today's listing.
import {
  listFolderTreeChildren,
  readFolderTreeNode,
  readFolderTreeScan,
  type FolderTreeScanRecord,
} from "../state/folder-tree-store.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import {
  isDepartmentFolderRejection,
  listDepartmentFolders,
  type DepartmentFolderListing,
  type DepartmentFolderRejection,
} from "./department-folder-listing.js";
import { folderRuleAbsolutePath } from "./folder-access-path.js";

/** One subfolder, with the extra fact the snapshot can afford to carry. */
export type FolderLevelEntry = {
  name: string;
  path: string;
  absolutePath: string;
  /** Present only from the snapshot: false means the row has no subfolders at all. */
  hasChildren?: boolean;
};

export type FolderLevel = {
  root: string;
  available: boolean;
  path: string;
  parent?: string;
  entries: FolderLevelEntry[];
  /** Where the answer came from, so the screen can say when it was last read. */
  source: "index" | "live";
  /** When the walk last read this folder's children. Absent for a live read. */
  indexedAt?: number;
};

export type FolderLevelResult = FolderLevel | DepartmentFolderRejection;

function toParent(folderPath: string): string | undefined {
  if (folderPath.length === 0) {
    return undefined;
  }
  const cut = folderPath.lastIndexOf("/");
  return cut <= 0 ? "" : folderPath.slice(0, cut);
}

function fromLiveListing(listing: DepartmentFolderListing): FolderLevel {
  return {
    root: listing.root,
    available: listing.available,
    path: listing.path,
    ...(listing.parent === undefined ? {} : { parent: listing.parent }),
    entries: listing.entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      absolutePath: entry.absolutePath,
    })),
    source: "live",
  };
}

/**
 * One level of the share, from the snapshot when it has been walked.
 *
 * The snapshot is used only when the walk actually read this folder's children
 * (`childrenScannedAt`), which is what separates "this folder is empty" from "nobody has
 * looked yet". Anything else falls through to the live listing.
 */
export async function readFolderLevel(
  params: {
    root: string;
    available: boolean;
    folderPath: string;
    /** Set false to read the NAS even when a snapshot exists. */
    useIndex?: boolean;
  },
  options: OpenClawStateDatabaseOptions = {},
): Promise<FolderLevelResult> {
  if (params.useIndex !== false && params.available) {
    const node = readFolderTreeNode(
      { scopeRoot: params.root, folderPath: params.folderPath },
      options,
    );
    if (node && node.childrenScannedAt > 0) {
      const children = listFolderTreeChildren(
        { scopeRoot: params.root, parentPath: params.folderPath },
        options,
      );
      const parent = toParent(params.folderPath);
      return {
        root: params.root,
        available: true,
        path: params.folderPath,
        ...(parent === undefined ? {} : { parent }),
        entries: children.map((child) => ({
          name: child.name,
          path: child.folderPath,
          absolutePath:
            child.absolutePath.length > 0
              ? child.absolutePath
              : folderRuleAbsolutePath(params.root, child.folderPath),
          hasChildren: child.childrenScannedAt === 0 ? true : child.childCount > 0,
        })),
        source: "index",
        indexedAt: node.childrenScannedAt,
      };
    }
  }
  const listing = await listDepartmentFolders({
    root: params.root,
    available: params.available,
    path: params.folderPath,
  });
  if (isDepartmentFolderRejection(listing)) {
    return listing;
  }
  return fromLiveListing(listing);
}

/** The last walk on this mount, for the "last updated" line on the screen. */
export function readFolderTreeScanStatus(
  root: string,
  options: OpenClawStateDatabaseOptions = {},
): FolderTreeScanRecord | undefined {
  return readFolderTreeScan(root, options);
}
