// The one place that turns folder rules into a verdict.
//
// Order matters, and the order is path first, subject second:
//
//   1. Walk the folder and its ancestors from the deepest outward.
//   2. At the first level that carries a rule for this person, stop.
//   3. Among the rules at that level, a person rule beats a department rule, which beats
//      a role rule. Two rules of the same kind (someone in two departments) resolve to
//      the more restrictive of the two.
//   4. No rule anywhere in the chain means hidden.
//
// Subject-first would break the requirement this feature exists for. If a personal rule
// opening `06_park` were consulted before the path, a department rule hiding
// `06_park/12. secure` further down could never take effect, and "open the share but
// close this one folder inside it" would be unexpressible. Path-first makes the deeper
// statement the deciding one, which is what an operator means when they write it.
//
// Two departments never add up to more access, for the same reason the department fence
// says so: adding a department is not a way to widen a boundary.
//
// The default is hidden because the measured tree is 37,356 folders with a `secure`
// folder inside every personal share. On a list that size something is always missed,
// and the thing that is missed must fail closed. A renamed folder loses its rules and so
// also falls back to hidden, which is the only mitigation that exists for renames.
import type {
  FolderAccessRule,
  FolderEffectiveRule,
  FolderRulePermission,
  FolderRuleSubjectKind,
} from "../../packages/gateway-protocol/src/schema/folder-rules.js";
import { normalizeDepartmentSlug } from "../state/departments-store.js";
import { folderRuleAncestry, hasExcludedFolderSegment } from "./folder-access-path.js";

/** Everything a folder verdict is allowed to depend on. */
export type FolderAccessIdentity = {
  profileId?: string | undefined;
  gatewayRole?: string | undefined;
  departments: readonly string[];
  isSuperAdmin: boolean;
};

/** A verdict, with the rule that produced it so a screen can explain itself. */
export type FolderAccessVerdict = {
  permission: FolderRulePermission;
  /** Folder the deciding rule sits on. Absent when nothing matched. */
  sourcePath?: string;
  /** True when the deciding rule sits on an ancestor rather than the folder asked about. */
  inherited: boolean;
};

const PERMISSION_STRENGTH: Record<FolderRulePermission, number> = {
  hidden: 0,
  read: 1,
  write: 2,
};

const SUBJECT_PRECEDENCE: Record<FolderRuleSubjectKind, number> = {
  role: 0,
  department: 1,
  user: 2,
};

/** The more restrictive of two permissions. */
export function narrowerPermission(
  left: FolderRulePermission,
  right: FolderRulePermission,
): FolderRulePermission {
  return PERMISSION_STRENGTH[left] <= PERMISSION_STRENGTH[right] ? left : right;
}

/** True when the permission lets the folder appear in a listing at all. */
export function isFolderVisible(permission: FolderRulePermission): boolean {
  return permission !== "hidden";
}

function matchesIdentity(rule: FolderAccessRule, identity: FolderAccessIdentity): boolean {
  if (rule.subjectKind === "user") {
    return identity.profileId !== undefined && rule.subjectId === identity.profileId;
  }
  if (rule.subjectKind === "department") {
    const wanted = normalizeDepartmentSlug(rule.subjectId);
    return identity.departments.some((slug) => normalizeDepartmentSlug(slug) === wanted);
  }
  return identity.gatewayRole !== undefined && rule.subjectId === identity.gatewayRole;
}

/**
 * Group rules by the folder they sit on.
 *
 * Callers hand in whatever the store returned for the ancestry chain; this keeps the
 * walk below independent of how the rows arrived.
 */
export function indexFolderRulesByPath(
  rules: readonly FolderAccessRule[],
): Map<string, FolderAccessRule[]> {
  const byPath = new Map<string, FolderAccessRule[]>();
  for (const rule of rules) {
    const bucket = byPath.get(rule.folderPath);
    if (bucket) {
      bucket.push(rule);
    } else {
      byPath.set(rule.folderPath, [rule]);
    }
  }
  return byPath;
}

function resolveAtLevel(
  candidates: readonly FolderAccessRule[],
): { permission: FolderRulePermission } | undefined {
  let bestPrecedence = -1;
  let permission: FolderRulePermission | undefined;
  for (const rule of candidates) {
    const precedence = SUBJECT_PRECEDENCE[rule.subjectKind];
    if (precedence > bestPrecedence) {
      bestPrecedence = precedence;
      permission = rule.permission;
      continue;
    }
    if (precedence === bestPrecedence && permission !== undefined) {
      permission = narrowerPermission(permission, rule.permission);
    }
  }
  return permission === undefined ? undefined : { permission };
}

/**
 * Decide one folder for one person.
 *
 * `folderPath` must already be normalized (src/gateway/folder-access-path.ts). A caller
 * that could not normalize a path passes nothing and gets the default, which is hidden.
 */
export function resolveFolderAccess(params: {
  folderPath: string | undefined;
  identity: FolderAccessIdentity;
  rules: readonly FolderAccessRule[];
}): FolderAccessVerdict {
  if (params.identity.isSuperAdmin) {
    // The same posture the department fence takes: no gate is built for this rank, so
    // none is bypassed either.
    return { permission: "write", inherited: false };
  }
  const folderPath = params.folderPath;
  if (folderPath === undefined || hasExcludedFolderSegment(folderPath)) {
    return { permission: "hidden", inherited: false };
  }
  const byPath = indexFolderRulesByPath(params.rules);
  const chain = folderRuleAncestry(folderPath);
  for (const [depth, level] of chain.entries()) {
    const atLevel = byPath.get(level);
    if (!atLevel) {
      continue;
    }
    const isExactFolder = depth === 0;
    const candidates = atLevel.filter(
      (rule) => (isExactFolder || rule.inherit) && matchesIdentity(rule, params.identity),
    );
    const resolved = resolveAtLevel(candidates);
    if (resolved) {
      return {
        permission: resolved.permission,
        sourcePath: level,
        inherited: !isExactFolder,
      };
    }
  }
  return { permission: "hidden", inherited: false };
}

/**
 * Every subject named anywhere in one folder's chain, with the verdict each would get.
 *
 * This is what the editor shows as "what actually applies", and it is computed with the
 * same walk the real decision uses rather than a second copy of the reasoning.
 */
export function resolveFolderEffectiveRules(params: {
  folderPath: string;
  rules: readonly FolderAccessRule[];
}): FolderEffectiveRule[] {
  const subjects = new Map<string, { kind: FolderRuleSubjectKind; id: string }>();
  for (const rule of params.rules) {
    subjects.set(`${rule.subjectKind}:${rule.subjectId}`, {
      kind: rule.subjectKind,
      id: rule.subjectId,
    });
  }
  const effective: FolderEffectiveRule[] = [];
  for (const subject of subjects.values()) {
    const verdict = resolveFolderAccess({
      folderPath: params.folderPath,
      identity: subjectIdentity(subject.kind, subject.id),
      rules: params.rules,
    });
    if (verdict.sourcePath === undefined) {
      continue;
    }
    effective.push({
      subjectKind: subject.kind,
      subjectId: subject.id,
      permission: verdict.permission,
      sourcePath: verdict.sourcePath,
      inherited: verdict.inherited,
    });
  }
  effective.sort(
    (left, right) =>
      SUBJECT_PRECEDENCE[right.subjectKind] - SUBJECT_PRECEDENCE[left.subjectKind] ||
      left.subjectId.localeCompare(right.subjectId),
  );
  return effective;
}

/**
 * A synthetic identity that matches exactly one subject.
 *
 * Used for the editor's preview and for the effective list. It carries no super-admin
 * flag on purpose: previewing a role must not answer with the rank of the person asking.
 */
export function subjectIdentity(kind: FolderRuleSubjectKind, id: string): FolderAccessIdentity {
  if (kind === "user") {
    return { profileId: id, departments: [], isSuperAdmin: false };
  }
  if (kind === "department") {
    return { departments: [id], isSuperAdmin: false };
  }
  return { gatewayRole: id, departments: [], isSuperAdmin: false };
}
