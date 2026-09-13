// The folder table read and written from the subject's side.
//
// folder-rules.ts answers "who may see this folder". The screen those methods feed makes
// an operator pick a folder first, which is the wrong order for the job people actually
// have: a person joins a department, or leaves one, and somebody has to walk the whole
// share deciding what that one subject may now reach. Done folder-first that is one
// visit per folder.
//
// So this file answers the same table from the other axis. `folders.subject.tree` walks
// the share as one named subject and reports, per folder, both what that subject gets
// today and what is written on that exact folder for them. `folders.rules.setMany`
// writes a page of those decisions in one call.
//
// Two rules are deliberately not restated here and are imported instead: the rank gate
// and the single refusal string. Hidden and absent have to keep answering identically,
// and a second copy of either would drift.
//
// One difference from `folders.tree.list` is load-bearing: this listing never drops a
// hidden folder. The whole purpose of the screen is to un-hide one, and a folder the
// editor cannot see is a folder the editor can never open. The rank check below is what
// keeps that from being an enumeration leak.
import {
  validateFoldersRulesSetManyParams,
  validateFoldersSubjectTreeParams,
  type FolderRuleSubjectKind,
  type FolderSubjectTreeEntry,
} from "../../../packages/gateway-protocol/src/index.js";
import { IX_AUTH_DEFAULT_SUPER_ADMIN_ROLES } from "../../auth/ix-auth/ix-auth-role-map.js";
import {
  clearFolderRule,
  clearFolderRuleDescendants,
  listAllFolderRules,
  setFolderRule,
} from "../../state/folder-access-store.js";
import { readClientDepartmentIdentity } from "../department-access.js";
import {
  isDepartmentFolderRejection,
  resolveDepartmentFolderRoot,
} from "../department-folder-listing.js";
import { isExcludedFolderName, normalizeFolderRulePath } from "../folder-access-path.js";
import {
  buildFolderRuleIndex,
  resolveFolderAccessIndexed,
  subjectIdentity,
  type FolderAccessIdentity,
} from "../folder-access-policy.js";
import { readFolderLevel } from "../folder-tree-index.js";
import {
  FOLDER_REFUSAL,
  mayManageFolderRules,
  recordFolderRuleAction,
  respondForbidden,
  respondRefused,
} from "./folder-rules.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

/**
 * The identity one named subject is judged by.
 *
 * `subjectIdentity` deliberately never sets the super-administrator flag, because the
 * folder-first preview must not answer with the rank of the person looking. Here the
 * subject is the thing being edited rather than a lens over somebody else's view, so the
 * one role that holds that rank has to report what it really gets: write everywhere. An
 * editor that showed `hidden` for the system administrator would invite rules that
 * change nothing.
 */
function editedSubjectIdentity(kind: FolderRuleSubjectKind, id: string): FolderAccessIdentity {
  const identity = subjectIdentity(kind, id);
  if (kind === "role" && IX_AUTH_DEFAULT_SUPER_ADMIN_ROLES.includes(id)) {
    return { ...identity, isSuperAdmin: true };
  }
  return identity;
}

export const folderRulesSubjectHandlers: GatewayRequestHandlers = {
  "folders.subject.tree": async ({ params, respond, client }) => {
    if (
      !assertValidParams(params, validateFoldersSubjectTreeParams, "folders.subject.tree", respond)
    ) {
      return;
    }
    if (!mayManageFolderRules(client)) {
      respondForbidden(respond);
      return;
    }
    const { root, available } = await resolveDepartmentFolderRoot();
    const folderPath = normalizeFolderRulePath(params.path, root);
    if (folderPath === undefined) {
      respondRefused(respond);
      return;
    }
    const level = await readFolderLevel({ root, available, folderPath });
    if (isDepartmentFolderRejection(level)) {
      respondRefused(respond);
      return;
    }
    // One grouped table for the whole level. Re-filtering the rule list per row turns a
    // cheap walk into a quadratic one on a share measured at 37,356 folders.
    const index = buildFolderRuleIndex(listAllFolderRules(root));
    const identity = editedSubjectIdentity(params.subjectKind, params.subjectId);
    const entries: FolderSubjectTreeEntry[] = [];
    for (const entry of level.entries) {
      if (isExcludedFolderName(entry.name)) {
        continue;
      }
      const childPath = normalizeFolderRulePath(entry.path, root);
      if (childPath === undefined) {
        continue;
      }
      const verdict = resolveFolderAccessIndexed({ folderPath: childPath, identity, index });
      const here = index.byPath.get(childPath) ?? [];
      const own = here.find(
        (rule) => rule.subjectKind === params.subjectKind && rule.subjectId === params.subjectId,
      );
      entries.push({
        name: entry.name,
        path: entry.path,
        absolutePath: entry.absolutePath,
        ...(entry.hasChildren === undefined ? {} : { hasChildren: entry.hasChildren }),
        effective: verdict.permission,
        ...(own === undefined
          ? {}
          : { ownRule: { permission: own.permission, inherit: own.inherit } }),
        ...(verdict.inherited && verdict.sourcePath !== undefined
          ? { inheritedFrom: verdict.sourcePath }
          : {}),
        ownRuleCount: here.length,
      });
    }
    respond(true, {
      root: level.root,
      available: level.available,
      path: level.path,
      ...(level.parent === undefined ? {} : { parent: level.parent }),
      entries,
      source: level.source,
      ...(level.indexedAt === undefined ? {} : { indexedAt: level.indexedAt }),
    });
  },

  /**
   * Write one subject's rules on many folders.
   *
   * Every item is attempted. A path the server refuses, or a write that throws, becomes
   * one failed row and the rest of the page still lands: the alternative is an operator
   * staring at a half-applied list with no way to tell which half. Each item keeps its
   * own ledger row, exactly as the single-folder writes do, so the audit screen cannot
   * tell a batched change from a hand-made one and does not have to.
   */
  "folders.rules.setMany": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateFoldersRulesSetManyParams,
        "folders.rules.setMany",
        respond,
      )
    ) {
      return;
    }
    if (!mayManageFolderRules(client)) {
      respondForbidden(respond);
      return;
    }
    const { root } = await resolveDepartmentFolderRoot();
    const profileId = readClientDepartmentIdentity(client)?.profileId;
    const results: { path: string; ok: boolean; error?: string }[] = [];
    for (const item of params.items) {
      const folderPath = normalizeFolderRulePath(item.path, root);
      if (folderPath === undefined) {
        results.push({ path: item.path, ok: false, error: FOLDER_REFUSAL });
        continue;
      }
      try {
        if (item.permission === null) {
          const removed = clearFolderRule({
            scopeRoot: root,
            folderPath,
            subjectKind: params.subjectKind,
            subjectId: params.subjectId,
          });
          recordFolderRuleAction({
            client,
            action: "folder-rule-clear",
            folderPath,
            subjectKind: params.subjectKind,
            subjectId: params.subjectId,
            detail: { removed },
          });
        } else {
          const rule = setFolderRule({
            scopeRoot: root,
            folderPath,
            subjectKind: params.subjectKind,
            subjectId: params.subjectId,
            permission: item.permission,
            inherit: item.inherit ?? true,
            ...(profileId === undefined ? {} : { createdByProfileId: profileId }),
            nowMs: Date.now(),
          });
          const removedDescendants =
            item.applyToDescendants === true
              ? clearFolderRuleDescendants({
                  scopeRoot: root,
                  folderPath,
                  subjectKind: params.subjectKind,
                  subjectId: params.subjectId,
                })
              : 0;
          recordFolderRuleAction({
            client,
            action: "folder-rule-set",
            folderPath,
            subjectKind: params.subjectKind,
            subjectId: params.subjectId,
            detail: { permission: item.permission, inherit: rule.inherit, removedDescendants },
          });
        }
        results.push({ path: item.path, ok: true });
      } catch (error) {
        results.push({
          path: item.path,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    respond(true, { results });
  },
};
