import type { DatabaseSync } from "node:sqlite";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

// Canonical additive schema for per-folder access rules on the shared mount. Feature
// local, like the department tables next door: a deployment that never mounts a share
// carries no rows and no table.
//
// The key is a path string rather than an identifier because a folder has no stable id.
// An inode changes the moment the mount is re-created, and the operator names folders by
// path anyway. The cost is that renaming a folder on the NAS orphans its rules, which is
// survivable only because the default verdict is "hidden": a renamed folder loses its
// rules and therefore closes rather than opens.
//
// `scope_root` is stored beside the path so a second mount root can be added later
// without every existing rule silently claiming folders under it.
const FOLDER_ACCESS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS folder_access_rules (
  id TEXT NOT NULL PRIMARY KEY,
  scope_root TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  inherit INTEGER NOT NULL,
  note TEXT,
  created_by_profile_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_access_rules_key
  ON folder_access_rules(scope_root, folder_path, subject_kind, subject_id);

CREATE INDEX IF NOT EXISTS idx_folder_access_rules_path
  ON folder_access_rules(scope_root, folder_path);
`;

export type FolderAccessDatabase = {
  folder_access_rules: {
    id: string;
    scope_root: string;
    folder_path: string;
    subject_kind: string;
    subject_id: string;
    permission: string;
    inherit: number;
    note: string | null;
    created_by_profile_id: string | null;
    created_at: number;
    updated_at: number;
  };
};

export type FolderAccessRuleRow = FolderAccessDatabase["folder_access_rules"];

const ensuredDatabases = new WeakSet<DatabaseSync>();

/** Install the folder rule table on first use. Idempotent and cached per handle. */
export function ensureFolderAccessSchema(
  options: OpenClawStateDatabaseOptions,
  database = openOpenClawStateDatabase(options),
): void {
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      db.exec(FOLDER_ACCESS_SCHEMA_SQL); // sqlite-allow-raw -- Canonical feature-local additive DDL.
    },
    options,
    { operationLabel: "folderAccess.schema.ensure" },
  );
  // Cache only a committed ensure so a rolled-back transaction stays retryable.
  ensuredDatabases.add(database.db);
}
