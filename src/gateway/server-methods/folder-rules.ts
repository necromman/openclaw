// Per-folder access rules over the Gateway connection.
//
// The department fence decides which agent a person may talk to. This surface decides
// which folder under the shared mount a person may see. They are separate axes on
// purpose: the fence stays exactly as it was, and this adds a flat plane underneath it.
//
// One refusal, used for every no.
//
// A folder that is hidden and a folder that does not exist answer identically, with the
// same message. Answering "forbidden" for the first would leak the folder's name, and
// leaking names is precisely what an operator writing a `hidden` rule is trying to
// prevent. The department fence uses the same convention.
//
// Rank, not scope.
//
// The descriptor scope says a connection may call these methods. It does not say who is
// calling: every signed-in browser session on this deployment carries the same scope
// list, because scopes come from one shared role definition, and an identity-server
// administrator does not hold `operator.admin` at all. So the rank check below is the
// real gate, and it reads the authorization facts on the connection rather than the
// ledger's attribution bag.
import {
  ErrorCodes,
  errorShape,
  validateFoldersRulesClearParams,
  validateFoldersRulesListParams,
  validateFoldersRulesOrphansClearParams,
  validateFoldersRulesOrphansParams,
  validateFoldersRulesSetParams,
  validateFoldersSubjectsListParams,
  type FolderOrphanRule,
  type FolderSubjectDepartment,
  type FolderSubjectUser,
} from "../../../packages/gateway-protocol/src/index.js";
import { recordUserActivity } from "../../audit/user-activity-audit-recorder.js";
import { IX_AUTH_DEFAULT_ROLE_MAP } from "../../auth/ix-auth/ix-auth-role-map.js";
import { listDepartments, normalizeDepartmentSlug } from "../../state/departments-store.js";
import {
  clearFolderRule,
  clearFolderRuleDescendants,
  listAllFolderRules,
  listFolderRulesForPaths,
  setFolderRule,
} from "../../state/folder-access-store.js";
import { listProfiles } from "../../state/user-profile-list.js";
import { readClientDepartmentIdentity } from "../department-access.js";
import {
  isDepartmentFolderRejection,
  listDepartmentFolders,
  resolveDepartmentFolderRoot,
} from "../department-folder-listing.js";
import {
  folderRuleAbsolutePath,
  folderRuleAncestry,
  normalizeFolderRulePath,
} from "../folder-access-path.js";
import {
  resolveFolderEffectiveRules,
  subjectIdentity,
  type FolderAccessIdentity,
} from "../folder-access-policy.js";
import { clientActivityActor } from "../ix-auth-audit-actor.js";
import { ADMIN_SCOPE } from "../operator-scopes.js";
import type { GatewayClient } from "./client-types.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

/** Ranks that may read and write folder rules. */
const FOLDER_RULE_MANAGER_ROLES = new Set(["superadmin", "admin"]);

/**
 * The single message every refusal on this surface carries.
 *
 * Hidden and absent must be indistinguishable, so they share one string. Changing it in
 * one branch and not the other would re-open the enumeration this feature closes.
 */
const FOLDER_REFUSAL = "path is outside the shared folder root";

export function respondRefused(respond: RespondFn): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, FOLDER_REFUSAL));
}

function respondForbidden(respond: RespondFn): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.FORBIDDEN, "Only an administrator can manage folder permissions."),
  );
}

/** The caller's authorization facts, or undefined for a host connection. */
export function callerIdentity(client: GatewayClient | null): FolderAccessIdentity | undefined {
  const identity = readClientDepartmentIdentity(client);
  if (!identity) {
    return undefined;
  }
  return {
    departments: identity.departments,
    isSuperAdmin: identity.isSuperAdmin,
    ...(identity.profileId === undefined ? {} : { profileId: identity.profileId }),
    ...(identity.gatewayRole === undefined ? {} : { gatewayRole: identity.gatewayRole }),
  };
}

/**
 * May this connection read and write folder rules.
 *
 * Administrators as well as system administrators, matching the users and departments
 * screens: running the company's folders is the same job as running its accounts. A
 * connection with no identity is the host shell or an operator token, already gated by
 * the descriptor scope.
 */
export function mayManageFolderRules(client: GatewayClient | null): boolean {
  const identity = readClientDepartmentIdentity(client);
  if (identity) {
    return identity.isSuperAdmin || FOLDER_RULE_MANAGER_ROLES.has(identity.gatewayRole ?? "");
  }
  const scopes = Array.isArray(client?.connect.scopes) ? client.connect.scopes : [];
  return scopes.includes(ADMIN_SCOPE);
}

/**
 * The identity a listing is evaluated against.
 *
 * A manager may ask to see the tree as some other subject would see it, which is the only
 * way to check that a rule hides what it claims to hide. A caller who may not manage
 * rules always gets their own verdicts: preview is a manager's tool, not a way to borrow
 * someone else's reach.
 */
export function viewingIdentity(params: {
  client: GatewayClient | null;
  manage: boolean;
  previewSubjectKind?: "role" | "department" | "user";
  previewSubjectId?: string;
}): FolderAccessIdentity {
  if (
    params.manage &&
    params.previewSubjectKind !== undefined &&
    params.previewSubjectId !== undefined
  ) {
    return subjectIdentity(params.previewSubjectKind, params.previewSubjectId);
  }
  const identity = callerIdentity(params.client);
  if (identity) {
    return identity;
  }
  // A host connection that passed the scope gate is the machine's own operator.
  return { departments: [], isSuperAdmin: true };
}

export const folderRulesHandlers: GatewayRequestHandlers = {
  "folders.rules.list": async ({ params, respond, client }) => {
    if (!assertValidParams(params, validateFoldersRulesListParams, "folders.rules.list", respond)) {
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
    const chain = folderRuleAncestry(folderPath);
    const chainRules = listFolderRulesForPaths({ scopeRoot: root, folderPaths: chain });
    const listing = await listDepartmentFolders({ root, available, path: folderPath });
    respond(true, {
      root,
      path: folderPath,
      exists: !isDepartmentFolderRejection(listing) && listing.available,
      rules: chainRules.filter((rule) => rule.folderPath === folderPath),
      inherited: chainRules.filter((rule) => rule.folderPath !== folderPath && rule.inherit),
      effective: resolveFolderEffectiveRules({ folderPath, rules: chainRules }),
    });
  },

  "folders.rules.set": async ({ params, respond, client }) => {
    if (!assertValidParams(params, validateFoldersRulesSetParams, "folders.rules.set", respond)) {
      return;
    }
    if (!mayManageFolderRules(client)) {
      respondForbidden(respond);
      return;
    }
    const { root } = await resolveDepartmentFolderRoot();
    const folderPath = normalizeFolderRulePath(params.path, root);
    if (folderPath === undefined) {
      respondRefused(respond);
      return;
    }
    const identity = readClientDepartmentIdentity(client);
    const rule = setFolderRule({
      scopeRoot: root,
      folderPath,
      subjectKind: params.subjectKind,
      subjectId: params.subjectId,
      permission: params.permission,
      inherit: params.inherit ?? true,
      ...(params.note === undefined ? {} : { note: params.note }),
      ...(identity?.profileId === undefined ? {} : { createdByProfileId: identity.profileId }),
      nowMs: Date.now(),
    });
    const removedDescendants =
      params.applyToDescendants === true
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
      detail: { permission: params.permission, inherit: rule.inherit, removedDescendants },
    });
    respond(true, { rule, removedDescendants });
  },

  "folders.rules.clear": async ({ params, respond, client }) => {
    if (
      !assertValidParams(params, validateFoldersRulesClearParams, "folders.rules.clear", respond)
    ) {
      return;
    }
    if (!mayManageFolderRules(client)) {
      respondForbidden(respond);
      return;
    }
    const { root } = await resolveDepartmentFolderRoot();
    const folderPath = normalizeFolderRulePath(params.path, root);
    if (folderPath === undefined) {
      respondRefused(respond);
      return;
    }
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
    respond(true, { removed });
  },

  "folders.rules.orphans": async ({ params, respond, client, context }) => {
    if (
      !assertValidParams(
        params,
        validateFoldersRulesOrphansParams,
        "folders.rules.orphans",
        respond,
      )
    ) {
      return;
    }
    if (!mayManageFolderRules(client)) {
      respondForbidden(respond);
      return;
    }
    const found = await collectOrphanRules(
      context.getRuntimeConfig()?.gateway?.auth?.ixAuth?.roleMap,
    );
    respond(true, {
      root: found.root,
      available: found.available,
      ruleCount: found.ruleCount,
      orphans: found.orphans,
    });
  },

  "folders.rules.orphansClear": async ({ params, respond, client, context }) => {
    if (
      !assertValidParams(
        params,
        validateFoldersRulesOrphansClearParams,
        "folders.rules.orphansClear",
        respond,
      )
    ) {
      return;
    }
    if (!mayManageFolderRules(client)) {
      respondForbidden(respond);
      return;
    }
    const found = await collectOrphanRules(
      context.getRuntimeConfig()?.gateway?.auth?.ixAuth?.roleMap,
    );
    if (!found.available) {
      // Nothing may be deleted on the word of a mount that is not here: every rule would
      // look orphaned and the whole table would go.
      respondRefused(respond);
      return;
    }
    // The listing is re-taken here rather than trusted from the screen. A folder that
    // came back between the operator reading the list and confirming it keeps its rules,
    // and a rule the screen never showed is never deleted by this call.
    const requested =
      params.paths === undefined
        ? undefined
        : new Set(params.paths.map((path) => normalizeFolderRulePath(path, found.root) ?? path));
    let removed = 0;
    for (const orphan of found.orphans) {
      if (requested && !requested.has(orphan.folderPath)) {
        continue;
      }
      removed += clearFolderRule({
        scopeRoot: found.root,
        folderPath: orphan.folderPath,
        subjectKind: orphan.subjectKind,
        subjectId: orphan.subjectId,
      });
      recordFolderRuleAction({
        client,
        action: "folder-rule-clear",
        folderPath: orphan.folderPath,
        subjectKind: orphan.subjectKind,
        subjectId: orphan.subjectId,
        detail: { removed: 1, orphanReason: orphan.reason },
      });
    }
    respond(true, { removed });
  },

  "folders.subjects.list": ({ params, respond, context, client }) => {
    if (
      !assertValidParams(
        params,
        validateFoldersSubjectsListParams,
        "folders.subjects.list",
        respond,
      )
    ) {
      return;
    }
    if (!mayManageFolderRules(client)) {
      respondForbidden(respond);
      return;
    }
    const configuredRoleMap = context.getRuntimeConfig()?.gateway?.auth?.ixAuth?.roleMap;
    const roleMap = configuredRoleMap ?? IX_AUTH_DEFAULT_ROLE_MAP;
    const roles = [...new Set(Object.values(roleMap))].toSorted();
    const users: FolderSubjectUser[] = [];
    for (const profile of listProfiles()) {
      if (profile.mergedInto) {
        continue;
      }
      const email = profile.emails[0];
      users.push({
        profileId: profile.id,
        ...(email ? { email } : {}),
        ...(profile.displayName ? { displayName: profile.displayName } : {}),
      });
    }
    const departments: FolderSubjectDepartment[] = [];
    for (const department of listDepartments()) {
      const entry: FolderSubjectDepartment = { slug: department.slug };
      if (department.display_name) {
        entry.displayName = department.display_name;
      }
      departments.push(entry);
    }
    respond(true, { roles, departments, users });
  },
};

/**
 * Every rule that no longer points at anything.
 *
 * Two ways a rule is orphaned, and both are checked here rather than in two screens:
 * the folder was renamed or deleted on the NAS, or the department or person the rule
 * names is gone from this deployment. Neither can be repaired automatically. A rename
 * cannot be told from a deletion, and a rule that was hiding a folder must never be
 * quietly re-pointed at whatever now sits at that path.
 *
 * Existence is asked of the same listing the tree uses, so a folder the mount cannot
 * reach at all is reported the same way here as it is there.
 */
async function collectOrphanRules(roleMap: Record<string, string> | undefined): Promise<{
  root: string;
  available: boolean;
  ruleCount: number;
  orphans: FolderOrphanRule[];
}> {
  const { root, available } = await resolveDepartmentFolderRoot();
  const rules = listAllFolderRules(root);
  if (!available) {
    return { available, orphans: [], root, ruleCount: rules.length };
  }
  const roles = new Set(Object.values(roleMap ?? IX_AUTH_DEFAULT_ROLE_MAP));
  const departments = new Set(listDepartments().map((row) => normalizeDepartmentSlug(row.slug)));
  const profiles = new Set(
    listProfiles()
      .filter((profile) => !profile.mergedInto)
      .map((profile) => profile.id),
  );
  const folderExists = new Map<string, boolean>();
  const orphans: FolderOrphanRule[] = [];
  for (const rule of rules) {
    let exists = folderExists.get(rule.folderPath);
    if (exists === undefined) {
      const listing = await listDepartmentFolders({ root, available, path: rule.folderPath });
      exists = !isDepartmentFolderRejection(listing) && listing.available;
      folderExists.set(rule.folderPath, exists);
    }
    const subjectExists =
      rule.subjectKind === "role"
        ? roles.has(rule.subjectId)
        : rule.subjectKind === "department"
          ? departments.has(normalizeDepartmentSlug(rule.subjectId))
          : profiles.has(rule.subjectId);
    if (exists && subjectExists) {
      continue;
    }
    orphans.push({
      reason: exists ? "missing-subject" : "missing-folder",
      folderPath: rule.folderPath,
      absolutePath: folderRuleAbsolutePath(root, rule.folderPath),
      subjectKind: rule.subjectKind,
      subjectId: rule.subjectId,
      permission: rule.permission,
      inherit: rule.inherit,
      updatedAt: rule.updatedAt,
    });
  }
  return { available, orphans, root, ruleCount: rules.length };
}

/** One ledger row per rule change, attributed to whoever made it. */
function recordFolderRuleAction(params: {
  client: GatewayClient | null;
  action: "folder-rule-set" | "folder-rule-clear";
  folderPath: string;
  subjectKind: string;
  subjectId: string;
  detail: Record<string, unknown>;
}): void {
  recordUserActivity({
    kind: "admin_action",
    actor: clientActivityActor(params.client),
    detail: {
      action: params.action,
      // Truncated the same way the ledger truncates every path it stores, so one very
      // deep folder cannot push the row past what the audit screen can render.
      path: params.folderPath.slice(0, 512),
      subjectKind: params.subjectKind,
      subjectId: params.subjectId,
      ...params.detail,
    },
  });
}
