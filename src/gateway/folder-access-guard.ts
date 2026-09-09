import { realpath } from "node:fs/promises";
// Applies the folder rules to the file surfaces a person browses.
//
// R built the rules, the verdict and the management screen. This module is the piece
// that puts the verdict in front of the reads: the session file panel, the workspace
// browsers, and the document preview that rides on top of the file read.
//
// Three properties this module exists to keep:
//
//   - One scope. Rules only ever describe the shared mount. A workspace that lives
//     somewhere else (the agent's own home directory, a git checkout) is not part of
//     this plane at all, so the gate reports "not applicable" and every caller keeps the
//     behaviour it had. Reporting "hidden" for those would close the product.
//   - One refusal. A hidden file is answered exactly the way a file that is not there is
//     answered, because a distinguishable refusal is an enumeration oracle and hiding
//     the name is the whole point of the rule.
//   - One decision. The verdict comes from folder-access-policy.ts, the same walk the
//     tree screen shows. A second copy of the reasoning here would drift, and the drift
//     would be invisible until it was a leak.
import path from "node:path";
import { listAllFolderRules } from "../state/folder-access-store.js";
import { readClientDepartmentIdentity } from "./department-access.js";
import { resolveDepartmentFolderRoot } from "./department-folder-listing.js";
import { normalizeFolderRulePath } from "./folder-access-path.js";
import {
  buildFolderRuleIndex,
  resolveFolderAccessIndexed,
  type FolderAccessIdentity,
} from "./folder-access-policy.js";
import type { GatewayClient } from "./server-methods/client-types.js";

/** What a browsing surface asks the rules about one path. */
export type FolderAccessGate = {
  /** True when the browsing root itself may be listed at all. */
  allowsRoot: boolean;
  /**
   * True when one root-relative path may appear in a listing or be read.
   *
   * A directory is decided by its own rule; a file is decided by the folder holding it,
   * because rules name folders and a file has no rule of its own.
   */
  allows: (relativePath: string, kind: "file" | "directory") => boolean;
};

function toPosixRelative(value: string): string {
  return value.split(path.sep).join("/");
}

/** The rule path of one browsing root, or undefined when the root is out of scope. */
function rootRulePath(scopeRoot: string, rootReal: string): string | undefined {
  const relative = path.relative(scopeRoot, rootReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return normalizeFolderRulePath(toPosixRelative(relative));
}

function joinRulePath(base: string, relative: string): string {
  const trimmed = relative.replace(/^\/+|\/+$/gu, "");
  if (trimmed.length === 0 || trimmed === ".") {
    return base;
  }
  return base.length === 0 ? trimmed : `${base}/${trimmed}`;
}

/** Folder that decides one entry: itself for a directory, its parent for a file. */
function decidingRelativePath(relativePath: string, kind: "file" | "directory"): string {
  if (kind === "directory") {
    return relativePath;
  }
  const parent = path.posix.dirname(relativePath.replaceAll("\\", "/"));
  return parent === "." || parent === "/" ? "" : parent;
}

/**
 * Build the gate for one caller browsing one root, or report that rules do not apply.
 *
 * `undefined` means "this surface is outside the folder plane": a host connection, a
 * system administrator, a deployment without verified identities, or a root that is not
 * under the shared mount. Callers treat it as "carry on exactly as before", which is
 * what keeps this change from touching every other deployment.
 */
export async function prepareFolderAccessGate(params: {
  client: Pick<GatewayClient, "internal"> | null;
  root: string | undefined;
}): Promise<FolderAccessGate | undefined> {
  if (!params.root) {
    return undefined;
  }
  const identity = readClientDepartmentIdentity(params.client);
  if (!identity || identity.isSuperAdmin) {
    return undefined;
  }
  const scope = await resolveDepartmentFolderRoot();
  if (!scope.available) {
    return undefined;
  }
  let rootReal: string;
  try {
    rootReal = await realpath(params.root);
  } catch {
    // A root that does not resolve cannot be placed inside the mount, and a path that
    // cannot be placed is not one this plane governs.
    return undefined;
  }
  const base = rootRulePath(scope.root, rootReal);
  if (base === undefined) {
    return undefined;
  }
  const gateIdentity: FolderAccessIdentity = {
    departments: identity.departments,
    isSuperAdmin: false,
    ...(identity.profileId === undefined ? {} : { profileId: identity.profileId }),
    ...(identity.gatewayRole === undefined ? {} : { gatewayRole: identity.gatewayRole }),
  };
  const index = buildFolderRuleIndex(listAllFolderRules(scope.root));
  const decide = (folderPath: string): boolean =>
    resolveFolderAccessIndexed({ folderPath, identity: gateIdentity, index }).permission !==
    "hidden";
  return {
    allowsRoot: decide(base),
    allows: (relativePath, kind) =>
      decide(joinRulePath(base, decidingRelativePath(relativePath, kind))),
  };
}
