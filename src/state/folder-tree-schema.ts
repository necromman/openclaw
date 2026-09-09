import type { DatabaseSync } from "node:sqlite";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

// Canonical additive schema for the folder tree snapshot of the shared mount. Feature
// local, exactly like the folder rule table next door: a deployment that never mounts a
// share carries no rows and no table.
//
// Why a snapshot exists at all. Drawing the tree used to mean reading the NAS on every
// expand, and the delivery NAS is a two-core DS218+ holding 37,356 folders. One level of
// a folder that also holds three thousand files cost 856 ms of `stat` calls (measured
// 2026-09-09), and that is per click, per person, forever. The snapshot turns that into
// one indexed SQLite read.
//
// Only folders are stored. File names are the part that changes hourly and the part the
// tree never draws, so keeping them would multiply the row count by twenty and buy
// nothing.
//
// `children_scanned_at` is separate from `scanned_at` on purpose. A row exists as soon as
// its parent was read, but its own children are unknown until the walk reaches it, and a
// folder with no subfolders has to be distinguishable from a folder nobody walked yet.
// Without that distinction an empty folder would look unscanned forever and every click
// on it would fall back to the NAS.
const FOLDER_TREE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS folder_tree_nodes (
  scope_root TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  parent_path TEXT NOT NULL,
  name TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  child_count INTEGER NOT NULL,
  readable INTEGER NOT NULL,
  children_scanned_at INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL,
  PRIMARY KEY (scope_root, folder_path)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_folder_tree_nodes_parent
  ON folder_tree_nodes(scope_root, parent_path);

CREATE TABLE IF NOT EXISTS folder_tree_scans (
  scope_root TEXT NOT NULL PRIMARY KEY,
  branch_path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  folder_count INTEGER NOT NULL,
  unreadable_count INTEGER NOT NULL,
  truncated INTEGER NOT NULL
) STRICT;
`;

export type FolderTreeDatabase = {
  folder_tree_nodes: {
    scope_root: string;
    folder_path: string;
    parent_path: string;
    name: string;
    absolute_path: string;
    child_count: number;
    readable: number;
    children_scanned_at: number;
    scanned_at: number;
  };
  folder_tree_scans: {
    scope_root: string;
    branch_path: string;
    started_at: number;
    /** 0 while a walk is in flight. Any other value is when it ended. */
    finished_at: number;
    duration_ms: number;
    folder_count: number;
    unreadable_count: number;
    truncated: number;
  };
};

export type FolderTreeNodeRow = FolderTreeDatabase["folder_tree_nodes"];
export type FolderTreeScanRow = FolderTreeDatabase["folder_tree_scans"];

const ensuredDatabases = new WeakSet<DatabaseSync>();

/** Install the folder tree tables on first use. Idempotent and cached per handle. */
export function ensureFolderTreeSchema(
  options: OpenClawStateDatabaseOptions,
  database = openOpenClawStateDatabase(options),
): void {
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      db.exec(FOLDER_TREE_SCHEMA_SQL); // sqlite-allow-raw -- Canonical feature-local additive DDL.
    },
    options,
    { operationLabel: "folderTree.schema.ensure" },
  );
  // Cache only a committed ensure so a rolled-back transaction stays retryable.
  ensuredDatabases.add(database.db);
}
