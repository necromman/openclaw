// Gateway calls the folder-access screen makes, in one place.
//
// Seven methods, one job: read the share one level at a time, read and write the rules
// pinned to one folder, read the subjects a rule may name, and list or clear the rules
// that no longer point at anything. Nothing here decides who may call them; the Gateway
// refuses every one of them for an account that is not an administrator, and this module
// would rather surface that refusal than pre-empt it.
//
// Optional parameters are assembled by spread rather than written as `key: undefined`,
// because the build runs with exactOptionalPropertyTypes and an explicit undefined is a
// different value from an absent key on the wire.
import type {
  FolderRulePermission,
  FolderRuleSubjectKind,
  FoldersRulesClearResult,
  FoldersRulesListResult,
  FoldersRulesOrphansClearResult,
  FoldersRulesOrphansResult,
  FoldersRulesSetResult,
  FoldersSubjectsListResult,
  FoldersTreeListResult,
} from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";

/** One level of the share, optionally seen through another subject's eyes. */
export async function fetchFolderTree(params: {
  client: GatewayBrowserClient;
  path?: string;
  previewSubjectKind?: FolderRuleSubjectKind;
  previewSubjectId?: string;
}): Promise<FoldersTreeListResult> {
  return params.client.request<FoldersTreeListResult>("folders.tree.list", {
    ...(params.path === undefined ? {} : { path: params.path }),
    ...(params.previewSubjectKind === undefined
      ? {}
      : { previewSubjectKind: params.previewSubjectKind }),
    ...(params.previewSubjectId === undefined ? {} : { previewSubjectId: params.previewSubjectId }),
  });
}

/** Every rule that bears on one folder: its own, its inherited, and the verdict. */
export async function fetchFolderRules(params: {
  client: GatewayBrowserClient;
  path: string;
}): Promise<FoldersRulesListResult> {
  return params.client.request<FoldersRulesListResult>("folders.rules.list", {
    path: params.path,
  });
}

export async function setFolderRule(params: {
  client: GatewayBrowserClient;
  path: string;
  subjectKind: FolderRuleSubjectKind;
  subjectId: string;
  permission: FolderRulePermission;
  inherit?: boolean;
  note?: string;
  applyToDescendants?: boolean;
}): Promise<FoldersRulesSetResult> {
  return params.client.request<FoldersRulesSetResult>("folders.rules.set", {
    path: params.path,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
    permission: params.permission,
    ...(params.inherit === undefined ? {} : { inherit: params.inherit }),
    ...(params.note === undefined ? {} : { note: params.note }),
    ...(params.applyToDescendants === undefined
      ? {}
      : { applyToDescendants: params.applyToDescendants }),
  });
}

export async function clearFolderRule(params: {
  client: GatewayBrowserClient;
  path: string;
  subjectKind: FolderRuleSubjectKind;
  subjectId: string;
}): Promise<FoldersRulesClearResult> {
  return params.client.request<FoldersRulesClearResult>("folders.rules.clear", {
    path: params.path,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
  });
}

/** The roles, departments and accounts a rule may name. */
export async function fetchFolderSubjects(
  client: GatewayBrowserClient,
): Promise<FoldersSubjectsListResult> {
  return client.request<FoldersSubjectsListResult>("folders.subjects.list", {});
}

/** Rules whose folder or whose subject is gone. */
export async function fetchFolderOrphans(
  client: GatewayBrowserClient,
): Promise<FoldersRulesOrphansResult> {
  return client.request<FoldersRulesOrphansResult>("folders.rules.orphans", {});
}

/**
 * Delete orphaned rules.
 *
 * Paths are sent rather than rule ids because the server re-checks each one before
 * deleting: a folder that reappeared between the listing and the confirmation keeps
 * whatever was set on it.
 */
export async function clearFolderOrphans(params: {
  client: GatewayBrowserClient;
  paths?: string[];
}): Promise<FoldersRulesOrphansClearResult> {
  return params.client.request<FoldersRulesOrphansClearResult>(
    "folders.rules.orphansClear",
    params.paths === undefined ? {} : { paths: params.paths },
  );
}
