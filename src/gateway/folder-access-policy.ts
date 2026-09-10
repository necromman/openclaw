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
function indexFolderRulesByPath(
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

/**
 * The rule table prepared once for many folders.
 *
 * A listing decides one folder per entry and an index run decides one per directory in a
 * tree measured at 37,356 of them. Re-grouping the table for every one of those turns a
 * cheap walk into a quadratic one, so the grouping is lifted out and the subjects the
 * table names are collected in the same pass.
 */
export type FolderRuleIndex = {
  byPath: Map<string, FolderAccessRule[]>;
  subjects: { kind: FolderRuleSubjectKind; id: string }[];
};

/** Prepare one rule table for repeated verdicts. */
export function buildFolderRuleIndex(rules: readonly FolderAccessRule[]): FolderRuleIndex {
  const subjects = new Map<string, { kind: FolderRuleSubjectKind; id: string }>();
  for (const rule of rules) {
    subjects.set(`${rule.subjectKind}:${rule.subjectId}`, {
      kind: rule.subjectKind,
      id: rule.subjectId,
    });
  }
  return { byPath: indexFolderRulesByPath(rules), subjects: [...subjects.values()] };
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
  return resolveFolderAccessIndexed({
    folderPath: params.folderPath,
    identity: params.identity,
    index: buildFolderRuleIndex(params.rules),
  });
}

/** The same decision against a table that was prepared once. */
export function resolveFolderAccessIndexed(params: {
  folderPath: string | undefined;
  identity: FolderAccessIdentity;
  index: FolderRuleIndex;
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
  const byPath = params.index.byPath;
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
  const index = buildFolderRuleIndex(params.rules);
  const effective: FolderEffectiveRule[] = [];
  for (const subject of index.subjects) {
    const verdict = resolveFolderAccessIndexed({
      folderPath: params.folderPath,
      identity: subjectIdentity(subject.kind, subject.id),
      index,
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

/**
 * True when at least one subject named in the rules may see this folder.
 *
 * The document index has no person behind it. `openclaw knowledge sync` is run by a cron
 * entry, and the sidecars it writes land in one shared pool that memory search reads, so
 * there is no request identity to decide against and no per-reader filter afterwards.
 *
 * The only verdict that can be taken at that moment is therefore about the folder rather
 * than about a reader: index a folder when the operator has deliberately opened it to
 * somebody, and leave it out when nobody has been named. A folder with no rule anywhere
 * in its chain is hidden from everyone by the default, so it produces no sidecar, and a
 * folder that is later hidden loses the sidecar it had (the sync already deletes a
 * sidecar whose source it no longer walks).
 *
 * The remaining gap is stated rather than papered over: a folder opened to one
 * department is in the same pool as one opened to another, so the index is not itself a
 * per-department boundary. That boundary is the agent's, and closing it inside the tools
 * is stage three.
 */
export function isFolderVisibleToAnySubject(params: {
  folderPath: string;
  index: FolderRuleIndex;
}): boolean {
  for (const subject of params.index.subjects) {
    const verdict = resolveFolderAccessIndexed({
      folderPath: params.folderPath,
      identity: subjectIdentity(subject.kind, subject.id),
      index: params.index,
    });
    if (verdict.permission !== "hidden") {
      return true;
    }
  }
  return false;
}
