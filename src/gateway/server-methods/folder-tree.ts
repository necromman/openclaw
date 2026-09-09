// Reading the shared mount's folder tree, and asking for it to be read again.
//
// Split from folder-rules.ts because the two answer different questions. That file owns
// "who may see this folder"; this one owns "where are the folders", which since stage X
// is a question about a stored snapshot rather than about the NAS. The verdict is still
// computed here, per request, from the rule table: the snapshot holds names and shapes
// and never a permission, so a rule written a second ago applies to a tree walked last
// night.
//
// The refusal, the rank check and the preview rules are the ones folder-rules.ts wrote.
// They are imported rather than restated so hidden and absent keep answering with one
// identical string.
import {
  validateFoldersTreeListParams,
  validateFoldersTreeRefreshParams,
  type FolderTreeEntry,
  type FolderTreeScanStatus,
} from "../../../packages/gateway-protocol/src/index.js";
import { listAllFolderRules } from "../../state/folder-access-store.js";
import type { FolderTreeScanRecord } from "../../state/folder-tree-store.js";
import {
  isDepartmentFolderRejection,
  resolveDepartmentFolderRoot,
} from "../department-folder-listing.js";
import { isExcludedFolderName, normalizeFolderRulePath } from "../folder-access-path.js";
import { resolveFolderAccess } from "../folder-access-policy.js";
import { readFolderLevel, readFolderTreeScanStatus } from "../folder-tree-index.js";
import { scanFolderTree } from "../folder-tree-scan.js";
import { recordAccessDeniedActivity } from "../session-view-activity-audit.js";
import { mayManageFolderRules, respondRefused, viewingIdentity } from "./folder-rules.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

function toScanStatus(record: FolderTreeScanRecord | undefined): FolderTreeScanStatus | undefined {
  if (!record) {
    return undefined;
  }
  const running = record.finishedAt === 0;
  return {
    running,
    branchPath: record.branchPath,
    startedAt: record.startedAt,
    ...(running ? {} : { finishedAt: record.finishedAt }),
    ...(running ? {} : { durationMs: record.durationMs }),
    ...(running ? {} : { folderCount: record.folderCount }),
    ...(running ? {} : { unreadableCount: record.unreadableCount }),
    ...(running ? {} : { truncated: record.truncated }),
  };
}

export const folderTreeHandlers: GatewayRequestHandlers = {
  "folders.tree.list": async ({ params, respond, client }) => {
    if (!assertValidParams(params, validateFoldersTreeListParams, "folders.tree.list", respond)) {
      return;
    }
    const manage = mayManageFolderRules(client);
    const { root, available } = await resolveDepartmentFolderRoot();
    const folderPath = normalizeFolderRulePath(params.path, root);
    if (folderPath === undefined) {
      respondRefused(respond);
      return;
    }
    const previewing =
      manage && params.previewSubjectKind !== undefined && params.previewSubjectId !== undefined;
    const identity = viewingIdentity({
      client,
      manage,
      ...(params.previewSubjectKind === undefined
        ? {}
        : { previewSubjectKind: params.previewSubjectKind }),
      ...(params.previewSubjectId === undefined
        ? {}
        : { previewSubjectId: params.previewSubjectId }),
    });
    // Hidden folders appear only in a manager's own view, where they have to appear or a
    // hidden folder could never be un-hidden. A preview is a claim about what somebody
    // else sees, so it hides exactly what they would not see; a preview that still showed
    // the folder would be no evidence at all.
    const showHidden = manage && !previewing;
    const rules = listAllFolderRules(root);
    // Nobody opens a folder their view cannot see, and the refusal is the same one an
    // absent folder gets.
    if (!showHidden && folderPath.length > 0) {
      const verdict = resolveFolderAccess({ folderPath, identity, rules });
      if (verdict.permission === "hidden") {
        if (!manage) {
          // A manager stepping through a preview is not being refused anything, so it is
          // not an access denial and does not belong in the ledger.
          recordAccessDeniedActivity({
            client,
            reason: "folder_rule",
            surface: "folder-tree",
          });
        }
        respondRefused(respond);
        return;
      }
    }
    const level = await readFolderLevel({ root, available, folderPath });
    if (isDepartmentFolderRejection(level)) {
      respondRefused(respond);
      return;
    }
    const entries: FolderTreeEntry[] = [];
    for (const entry of level.entries) {
      if (isExcludedFolderName(entry.name)) {
        continue;
      }
      const childPath = normalizeFolderRulePath(entry.path, root);
      if (childPath === undefined) {
        continue;
      }
      const verdict = resolveFolderAccess({ folderPath: childPath, identity, rules });
      if (!showHidden && verdict.permission === "hidden") {
        continue;
      }
      entries.push({
        name: entry.name,
        path: entry.path,
        absolutePath: entry.absolutePath,
        permission: verdict.permission,
        inherited: verdict.inherited,
        ...(verdict.sourcePath === undefined ? {} : { sourcePath: verdict.sourcePath }),
        ownRuleCount: rules.filter((rule) => rule.folderPath === childPath).length,
        ...(entry.hasChildren === undefined ? {} : { hasChildren: entry.hasChildren }),
      });
    }
    const scan = toScanStatus(readFolderTreeScanStatus(root));
    respond(true, {
      root: level.root,
      available: level.available,
      path: level.path,
      ...(level.parent === undefined ? {} : { parent: level.parent }),
      manage,
      entries,
      source: level.source,
      ...(level.indexedAt === undefined ? {} : { indexedAt: level.indexedAt }),
      ...(scan === undefined ? {} : { scan }),
    });
  },

  /**
   * Walk one branch again.
   *
   * The walk is started and left to run, and the response says only whether it is now in
   * flight. A full walk of the delivery share is tens of seconds of NAS reads, and a
   * request that waited for it would time out on the tunnel long before it finished.
   * Failures are logged by the walk itself; the screen sees them as a scan whose stamp
   * did not move.
   */
  "folders.tree.refresh": async ({ params, respond, client }) => {
    if (
      !assertValidParams(params, validateFoldersTreeRefreshParams, "folders.tree.refresh", respond)
    ) {
      return;
    }
    if (!mayManageFolderRules(client)) {
      respondRefused(respond);
      return;
    }
    const { root, available } = await resolveDepartmentFolderRoot();
    if (!available) {
      respondRefused(respond);
      return;
    }
    const branchPath = normalizeFolderRulePath(params.path, root);
    if (branchPath === undefined) {
      respondRefused(respond);
      return;
    }
    const existing = toScanStatus(readFolderTreeScanStatus(root));
    if (existing?.running) {
      respond(true, { started: false, scan: existing });
      return;
    }
    const started = scanFolderTree({ root, branchPath });
    void started.catch(() => {
      // The walk logs its own failures. Losing one refresh must not take the connection
      // down with it.
    });
    const scan = toScanStatus(readFolderTreeScanStatus(root));
    respond(true, { started: true, ...(scan === undefined ? {} : { scan }) });
  },
};
