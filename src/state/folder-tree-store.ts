// Durable store for the folder tree snapshot of the shared mount.
//
// Row access goes through Kysely; only the DDL in folder-tree-schema.ts is raw SQL.
//
// Nothing here reads the filesystem and nothing here decides who may see a folder. The
// walk lives in src/gateway/folder-tree-scan.ts and the verdict lives in
// folder-access-policy.ts, so this file is only "what did the last walk find".
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  ensureFolderTreeSchema,
  type FolderTreeDatabase,
  type FolderTreeNodeRow,
  type FolderTreeScanRow,
} from "./folder-tree-schema.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

function folderTreeDb(db: DatabaseSync) {
  return getNodeSqliteKysely<FolderTreeDatabase>(db);
}

/**
 * Rows written per transaction.
 *
 * Every row carries nine bound values, so a batch of two hundred stays far below the
 * bound-parameter ceiling while keeping a full walk of the delivery share at a few
 * hundred transactions rather than tens of thousands.
 */
const WRITE_BATCH_SIZE = 200;

/** One folder as the last walk saw it. */
export type FolderTreeNode = {
  folderPath: string;
  parentPath: string;
  name: string;
  absolutePath: string;
  childCount: number;
  /** False when the walk was refused the directory. The NAS ACL is the usual reason. */
  readable: boolean;
  /** When this folder's own children were last read. 0 means never. */
  childrenScannedAt: number;
  scannedAt: number;
};

export type FolderTreeScanRecord = {
  branchPath: string;
  startedAt: number;
  /** 0 while the walk is still running. */
  finishedAt: number;
  durationMs: number;
  folderCount: number;
  unreadableCount: number;
  truncated: boolean;
};

function toNode(row: FolderTreeNodeRow): FolderTreeNode {
  return {
    folderPath: row.folder_path,
    parentPath: row.parent_path,
    name: row.name,
    absolutePath: row.absolute_path,
    childCount: row.child_count,
    readable: row.readable !== 0,
    childrenScannedAt: row.children_scanned_at,
    scannedAt: row.scanned_at,
  };
}

function toScanRecord(row: FolderTreeScanRow): FolderTreeScanRecord {
  return {
    branchPath: row.branch_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    folderCount: row.folder_count,
    unreadableCount: row.unreadable_count,
    truncated: row.truncated !== 0,
  };
}

/** One folder's snapshot row, or nothing when no walk has reached it. */
export function readFolderTreeNode(
  params: { scopeRoot: string; folderPath: string },
  options: OpenClawStateDatabaseOptions = {},
): FolderTreeNode | undefined {
  ensureFolderTreeSchema(options);
  const database = openOpenClawStateDatabase(options);
  const row = executeSqliteQuerySync(
    database.db,
    folderTreeDb(database.db)
      .selectFrom("folder_tree_nodes")
      .selectAll()
      .where("scope_root", "=", params.scopeRoot)
      .where("folder_path", "=", params.folderPath),
  ).rows[0];
  return row ? toNode(row) : undefined;
}

/**
 * The subfolders of one folder, as the last walk saw them.
 *
 * The self row shares `parent_path` with its own children at the root (both are the empty
 * string), so it is excluded by comparing the two columns rather than by a second query.
 */
export function listFolderTreeChildren(
  params: { scopeRoot: string; parentPath: string },
  options: OpenClawStateDatabaseOptions = {},
): FolderTreeNode[] {
  ensureFolderTreeSchema(options);
  const database = openOpenClawStateDatabase(options);
  const rows = executeSqliteQuerySync(
    database.db,
    folderTreeDb(database.db)
      .selectFrom("folder_tree_nodes")
      .selectAll()
      .where("scope_root", "=", params.scopeRoot)
      .where("parent_path", "=", params.parentPath)
      .where("folder_path", "!=", params.parentPath)
      .orderBy("name"),
  ).rows;
  return rows.map(toNode);
}

function writeNodeBatches(
  scopeRoot: string,
  nodes: readonly FolderTreeNode[],
  options: OpenClawStateDatabaseOptions,
  mode: "seen" | "scanned",
): void {
  for (let start = 0; start < nodes.length; start += WRITE_BATCH_SIZE) {
    const batch = nodes.slice(start, start + WRITE_BATCH_SIZE);
    runOpenClawStateWriteTransaction(
      ({ db }) => {
        executeSqliteQuerySync(
          db,
          folderTreeDb(db)
            .insertInto("folder_tree_nodes")
            .values(
              batch.map((node) => ({
                scope_root: scopeRoot,
                folder_path: node.folderPath,
                parent_path: node.parentPath,
                name: node.name,
                absolute_path: node.absolutePath,
                child_count: node.childCount,
                readable: node.readable ? 1 : 0,
                children_scanned_at: node.childrenScannedAt,
                scanned_at: node.scannedAt,
              })),
            )
            .onConflict((conflict) =>
              // "seen" is written when a folder shows up in its parent's listing, before
              // anything is known about its own contents. It must not erase what an
              // earlier walk learned about those contents, or every node would drop back
              // to "never scanned" for the length of the walk.
              mode === "seen"
                ? conflict.columns(["scope_root", "folder_path"]).doUpdateSet({
                    parent_path: (eb) => eb.ref("excluded.parent_path"),
                    name: (eb) => eb.ref("excluded.name"),
                    absolute_path: (eb) => eb.ref("excluded.absolute_path"),
                    scanned_at: (eb) => eb.ref("excluded.scanned_at"),
                  })
                : conflict.columns(["scope_root", "folder_path"]).doUpdateSet({
                    parent_path: (eb) => eb.ref("excluded.parent_path"),
                    name: (eb) => eb.ref("excluded.name"),
                    absolute_path: (eb) => eb.ref("excluded.absolute_path"),
                    child_count: (eb) => eb.ref("excluded.child_count"),
                    readable: (eb) => eb.ref("excluded.readable"),
                    children_scanned_at: (eb) => eb.ref("excluded.children_scanned_at"),
                    scanned_at: (eb) => eb.ref("excluded.scanned_at"),
                  }),
            ),
        );
      },
      options,
      { operationLabel: `folderTree.nodes.${mode}` },
    );
  }
}

/** Record folders the walk has seen listed, without claiming to know their contents. */
export function recordFolderTreeNodesSeen(
  params: { scopeRoot: string; nodes: readonly FolderTreeNode[] },
  options: OpenClawStateDatabaseOptions = {},
): void {
  if (params.nodes.length === 0) {
    return;
  }
  ensureFolderTreeSchema(options);
  writeNodeBatches(params.scopeRoot, params.nodes, options, "seen");
}

/** Record folders the walk has read, contents and all. */
export function recordFolderTreeNodesScanned(
  params: { scopeRoot: string; nodes: readonly FolderTreeNode[] },
  options: OpenClawStateDatabaseOptions = {},
): void {
  if (params.nodes.length === 0) {
    return;
  }
  ensureFolderTreeSchema(options);
  writeNodeBatches(params.scopeRoot, params.nodes, options, "scanned");
}

/**
 * Drop rows under one branch that this walk did not touch.
 *
 * The prefix match is done in TypeScript rather than with a SQL `LIKE`, because these
 * folder names are full of `_` and `%` and a pattern would quietly match the wrong
 * siblings. `00_공용폴더` alone would match `000공용폴더` under `LIKE`.
 */
export function pruneFolderTreeBranch(
  params: { scopeRoot: string; branchPath: string; seenBefore: number },
  options: OpenClawStateDatabaseOptions = {},
): number {
  ensureFolderTreeSchema(options);
  const prefix = params.branchPath.length === 0 ? "" : `${params.branchPath}/`;
  return runOpenClawStateWriteTransaction(
    ({ db }) => {
      const rows = executeSqliteQuerySync(
        db,
        folderTreeDb(db)
          .selectFrom("folder_tree_nodes")
          .select(["folder_path", "scanned_at"])
          .where("scope_root", "=", params.scopeRoot),
      ).rows;
      const doomed = rows
        .filter(
          (row) =>
            row.scanned_at < params.seenBefore &&
            (prefix.length === 0 ||
              row.folder_path === params.branchPath ||
              row.folder_path.startsWith(prefix)),
        )
        .map((row) => row.folder_path);
      if (doomed.length === 0) {
        return 0;
      }
      for (let start = 0; start < doomed.length; start += WRITE_BATCH_SIZE) {
        executeSqliteQuerySync(
          db,
          folderTreeDb(db)
            .deleteFrom("folder_tree_nodes")
            .where("scope_root", "=", params.scopeRoot)
            .where("folder_path", "in", doomed.slice(start, start + WRITE_BATCH_SIZE)),
        );
      }
      return doomed.length;
    },
    options,
    { operationLabel: "folderTree.nodes.prune" },
  );
}

/** The last walk recorded for one mount, running or finished. */
export function readFolderTreeScan(
  scopeRoot: string,
  options: OpenClawStateDatabaseOptions = {},
): FolderTreeScanRecord | undefined {
  ensureFolderTreeSchema(options);
  const database = openOpenClawStateDatabase(options);
  const row = executeSqliteQuerySync(
    database.db,
    folderTreeDb(database.db)
      .selectFrom("folder_tree_scans")
      .selectAll()
      .where("scope_root", "=", scopeRoot),
  ).rows[0];
  return row ? toScanRecord(row) : undefined;
}

/**
 * Claim the right to walk this mount, or refuse.
 *
 * The claim is a row rather than a process-local flag because two processes can want it:
 * the Gateway serving a refresh button, and the nightly cron running the CLI in the same
 * container. Two walks of a two-core NAS at once is the one outcome worth preventing.
 *
 * A claim older than `staleAfterMs` is taken over, the same rule the deploy script uses
 * for its lock: a process that died mid-walk must not stop every later walk forever.
 */
export function beginFolderTreeScan(
  params: {
    scopeRoot: string;
    branchPath: string;
    nowMs: number;
    staleAfterMs: number;
  },
  options: OpenClawStateDatabaseOptions = {},
): boolean {
  ensureFolderTreeSchema(options);
  return runOpenClawStateWriteTransaction(
    ({ db }) => {
      const existing = executeSqliteQuerySync(
        db,
        folderTreeDb(db)
          .selectFrom("folder_tree_scans")
          .selectAll()
          .where("scope_root", "=", params.scopeRoot),
      ).rows[0];
      if (
        existing &&
        existing.finished_at === 0 &&
        params.nowMs - existing.started_at < params.staleAfterMs
      ) {
        return false;
      }
      const row = {
        scope_root: params.scopeRoot,
        branch_path: params.branchPath,
        started_at: params.nowMs,
        finished_at: 0,
        duration_ms: 0,
        folder_count: 0,
        unreadable_count: 0,
        truncated: 0,
      };
      executeSqliteQuerySync(
        db,
        folderTreeDb(db)
          .insertInto("folder_tree_scans")
          .values(row)
          .onConflict((conflict) =>
            conflict.column("scope_root").doUpdateSet({
              branch_path: row.branch_path,
              started_at: row.started_at,
              finished_at: 0,
              duration_ms: 0,
              folder_count: 0,
              unreadable_count: 0,
              truncated: 0,
            }),
          ),
      );
      return true;
    },
    options,
    { operationLabel: "folderTree.scan.begin" },
  );
}

/** Close the claim with what the walk found. */
export function finishFolderTreeScan(
  params: {
    scopeRoot: string;
    nowMs: number;
    durationMs: number;
    folderCount: number;
    unreadableCount: number;
    truncated: boolean;
  },
  options: OpenClawStateDatabaseOptions = {},
): void {
  ensureFolderTreeSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        folderTreeDb(db)
          .updateTable("folder_tree_scans")
          .set({
            finished_at: params.nowMs,
            duration_ms: params.durationMs,
            folder_count: params.folderCount,
            unreadable_count: params.unreadableCount,
            truncated: params.truncated ? 1 : 0,
          })
          .where("scope_root", "=", params.scopeRoot),
      );
    },
    options,
    { operationLabel: "folderTree.scan.finish" },
  );
}

/** Forget the snapshot for one mount. The tree falls back to reading the NAS live. */
export function clearFolderTreeIndex(
  scopeRoot: string,
  options: OpenClawStateDatabaseOptions = {},
): void {
  ensureFolderTreeSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        folderTreeDb(db).deleteFrom("folder_tree_nodes").where("scope_root", "=", scopeRoot),
      );
      executeSqliteQuerySync(
        db,
        folderTreeDb(db).deleteFrom("folder_tree_scans").where("scope_root", "=", scopeRoot),
      );
    },
    options,
    { operationLabel: "folderTree.index.clear" },
  );
}
