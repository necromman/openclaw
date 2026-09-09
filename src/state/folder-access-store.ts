// Durable store for per-folder access rules.
//
// Row access goes through Kysely; only the DDL in folder-access-schema.ts is raw SQL.
//
// Nothing here decides anything. The store hands back rows and the policy module in
// src/gateway/folder-access-policy.ts turns them into a verdict, so there is exactly one
// place where "who wins" is written down.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  FolderAccessRule,
  FolderRulePermission,
  FolderRuleSubjectKind,
} from "../../packages/gateway-protocol/src/schema/folder-rules.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  ensureFolderAccessSchema,
  type FolderAccessDatabase,
  type FolderAccessRuleRow,
} from "./folder-access-schema.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

function folderAccessDb(db: DatabaseSync) {
  return getNodeSqliteKysely<FolderAccessDatabase>(db);
}

const SUBJECT_KINDS: readonly FolderRuleSubjectKind[] = ["role", "department", "user"];
const PERMISSIONS: readonly FolderRulePermission[] = ["hidden", "read", "write"];

/** True when a stored string is still one of the kinds this build understands. */
export function isFolderRuleSubjectKind(value: string): value is FolderRuleSubjectKind {
  return (SUBJECT_KINDS as readonly string[]).includes(value);
}

/** True when a stored string is still one of the permissions this build understands. */
export function isFolderRulePermission(value: string): value is FolderRulePermission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Shape one row for the wire, or drop it.
 *
 * A row whose kind or permission this build does not know is dropped rather than coerced.
 * Coercing would invent a verdict nobody wrote, and dropping fails toward "no rule",
 * which the policy reads as hidden.
 */
function toFolderAccessRule(row: FolderAccessRuleRow): FolderAccessRule | undefined {
  if (!isFolderRuleSubjectKind(row.subject_kind) || !isFolderRulePermission(row.permission)) {
    return undefined;
  }
  return {
    id: row.id,
    folderPath: row.folder_path,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    permission: row.permission,
    inherit: row.inherit !== 0,
    ...(row.note ? { note: row.note } : {}),
    ...(row.created_by_profile_id ? { createdByProfileId: row.created_by_profile_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowsToRules(rows: readonly FolderAccessRuleRow[]): FolderAccessRule[] {
  const rules: FolderAccessRule[] = [];
  for (const row of rows) {
    const rule = toFolderAccessRule(row);
    if (rule) {
      rules.push(rule);
    }
  }
  return rules;
}

/**
 * Every rule attached to any folder in one ancestry chain.
 *
 * The chain is passed in rather than derived here so the caller's normalization is the
 * only normalization: a store that re-split paths would be a second opinion on what a
 * path means. One query for the whole chain keeps a deep folder at one round trip
 * instead of twenty-three.
 */
export function listFolderRulesForPaths(
  params: { scopeRoot: string; folderPaths: readonly string[] },
  options: OpenClawStateDatabaseOptions = {},
): FolderAccessRule[] {
  if (params.folderPaths.length === 0) {
    return [];
  }
  ensureFolderAccessSchema(options);
  const database = openOpenClawStateDatabase(options);
  const rows = executeSqliteQuerySync(
    database.db,
    folderAccessDb(database.db)
      .selectFrom("folder_access_rules")
      .selectAll()
      .where("scope_root", "=", params.scopeRoot)
      .where("folder_path", "in", [...params.folderPaths])
      .orderBy("folder_path")
      .orderBy("subject_kind")
      .orderBy("subject_id"),
  ).rows;
  return rowsToRules(rows);
}

/** Every rule under one scope root, ordered by path. Used by the tree and by exports. */
export function listAllFolderRules(
  scopeRoot: string,
  options: OpenClawStateDatabaseOptions = {},
): FolderAccessRule[] {
  ensureFolderAccessSchema(options);
  const database = openOpenClawStateDatabase(options);
  const rows = executeSqliteQuerySync(
    database.db,
    folderAccessDb(database.db)
      .selectFrom("folder_access_rules")
      .selectAll()
      .where("scope_root", "=", scopeRoot)
      .orderBy("folder_path")
      .orderBy("subject_kind")
      .orderBy("subject_id"),
  ).rows;
  return rowsToRules(rows);
}

/**
 * Write one rule, replacing any rule that already names the same subject on the same
 * folder.
 *
 * `nowMs` is injected rather than read here so a test can pin the row and so two rules
 * written in one operator action carry the same timestamp.
 */
export function setFolderRule(
  params: {
    scopeRoot: string;
    folderPath: string;
    subjectKind: FolderRuleSubjectKind;
    subjectId: string;
    permission: FolderRulePermission;
    inherit: boolean;
    note?: string;
    createdByProfileId?: string;
    nowMs: number;
  },
  options: OpenClawStateDatabaseOptions = {},
): FolderAccessRule {
  ensureFolderAccessSchema(options);
  const note = params.note?.trim();
  return runOpenClawStateWriteTransaction(
    ({ db }) => {
      const existing = executeSqliteQuerySync(
        db,
        folderAccessDb(db)
          .selectFrom("folder_access_rules")
          .selectAll()
          .where("scope_root", "=", params.scopeRoot)
          .where("folder_path", "=", params.folderPath)
          .where("subject_kind", "=", params.subjectKind)
          .where("subject_id", "=", params.subjectId),
      ).rows[0];
      const row: FolderAccessRuleRow = {
        id: existing?.id ?? randomUUID(),
        scope_root: params.scopeRoot,
        folder_path: params.folderPath,
        subject_kind: params.subjectKind,
        subject_id: params.subjectId,
        permission: params.permission,
        inherit: params.inherit ? 1 : 0,
        note: note && note.length > 0 ? note : null,
        created_by_profile_id: params.createdByProfileId ?? existing?.created_by_profile_id ?? null,
        created_at: existing?.created_at ?? params.nowMs,
        updated_at: params.nowMs,
      };
      if (existing) {
        executeSqliteQuerySync(
          db,
          folderAccessDb(db)
            .updateTable("folder_access_rules")
            .set({
              permission: row.permission,
              inherit: row.inherit,
              note: row.note,
              created_by_profile_id: row.created_by_profile_id,
              updated_at: row.updated_at,
            })
            .where("id", "=", row.id),
        );
      } else {
        executeSqliteQuerySync(
          db,
          folderAccessDb(db).insertInto("folder_access_rules").values(row),
        );
      }
      // The row was just written from known-good values, so the projection cannot fail.
      return toFolderAccessRule(row) as FolderAccessRule;
    },
    options,
    { operationLabel: "folderAccess.rule.set" },
  );
}

/** Remove one subject's rule from exactly one folder. Returns how many rows went. */
export function clearFolderRule(
  params: {
    scopeRoot: string;
    folderPath: string;
    subjectKind: FolderRuleSubjectKind;
    subjectId: string;
  },
  options: OpenClawStateDatabaseOptions = {},
): number {
  ensureFolderAccessSchema(options);
  return runOpenClawStateWriteTransaction(
    ({ db }) => {
      const matches = executeSqliteQuerySync(
        db,
        folderAccessDb(db)
          .selectFrom("folder_access_rules")
          .select("id")
          .where("scope_root", "=", params.scopeRoot)
          .where("folder_path", "=", params.folderPath)
          .where("subject_kind", "=", params.subjectKind)
          .where("subject_id", "=", params.subjectId),
      ).rows;
      if (matches.length === 0) {
        return 0;
      }
      executeSqliteQuerySync(
        db,
        folderAccessDb(db)
          .deleteFrom("folder_access_rules")
          .where(
            "id",
            "in",
            matches.map((match) => match.id),
          ),
      );
      return matches.length;
    },
    options,
    { operationLabel: "folderAccess.rule.clear" },
  );
}

/**
 * Remove one subject's rules strictly below one folder.
 *
 * This is the second half of "apply to this folder and everything under it". Leaving the
 * deeper rules in place would produce a tree where the operator applied a rule to a whole
 * subtree and a few folders still disagree, with nothing on screen to say why.
 */
export function clearFolderRuleDescendants(
  params: {
    scopeRoot: string;
    folderPath: string;
    subjectKind: FolderRuleSubjectKind;
    subjectId: string;
  },
  options: OpenClawStateDatabaseOptions = {},
): number {
  ensureFolderAccessSchema(options);
  const prefix = params.folderPath.length === 0 ? "" : `${params.folderPath}/`;
  return runOpenClawStateWriteTransaction(
    ({ db }) => {
      const rows = executeSqliteQuerySync(
        db,
        folderAccessDb(db)
          .selectFrom("folder_access_rules")
          .select(["id", "folder_path"])
          .where("scope_root", "=", params.scopeRoot)
          .where("subject_kind", "=", params.subjectKind)
          .where("subject_id", "=", params.subjectId),
      ).rows;
      // Filtering here rather than with a SQL LIKE keeps the wildcard characters that are
      // common in these folder names (`#`, `%`, `_`) from being read as patterns.
      const doomed = rows.filter(
        (row) =>
          row.folder_path !== params.folderPath &&
          (prefix.length === 0 || row.folder_path.startsWith(prefix)),
      );
      if (doomed.length === 0) {
        return 0;
      }
      executeSqliteQuerySync(
        db,
        folderAccessDb(db)
          .deleteFrom("folder_access_rules")
          .where(
            "id",
            "in",
            doomed.map((row) => row.id),
          ),
      );
      return doomed.length;
    },
    options,
    { operationLabel: "folderAccess.rule.clearDescendants" },
  );
}

/** How many rules exist under one scope root. Cheap enough for a screen header. */
export function countFolderRules(
  scopeRoot: string,
  options: OpenClawStateDatabaseOptions = {},
): number {
  return listAllFolderRules(scopeRoot, options).length;
}
