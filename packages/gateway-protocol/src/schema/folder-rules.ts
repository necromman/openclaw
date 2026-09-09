// Gateway Protocol schema module for per-folder access rules on the shared mount.
//
// The department fence decides which agent a person may talk to. This surface decides
// which folder under the mount root a person may see, which is a different axis: one
// folder can be open to one department, hidden from a second, and opened again to a
// single person inside the second. So the rules are a flat table keyed by path, and the
// verdict for one person is computed from the deepest matching rule, never stored.
//
// Paths on the wire are root-relative and normalized (NFC, no `..`, no leading slash),
// with `""` meaning the mount root itself. An absolute path is never accepted from a
// caller: the server owns what "inside the root" means, and a browser that could name a
// root would own it instead. Absolute paths do travel outward, because the operator has
// to recognize the folder being ruled on.
//
// There is no rule kind for "allow everything below". Inheritance is a flag on the rule
// so that "this folder only" and "this folder and everything under it" stay two different
// statements; collapsing them would make an exception impossible to express.
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

/** Whose rule this is. More specific kinds win over less specific ones. */
export const FolderRuleSubjectKindSchema = Type.Union([
  Type.Literal("role"),
  Type.Literal("department"),
  Type.Literal("user"),
]);

/** What the rule grants. `hidden` means the folder is not reported to exist at all. */
export const FolderRulePermissionSchema = Type.Union([
  Type.Literal("hidden"),
  Type.Literal("read"),
  Type.Literal("write"),
]);

/** One stored rule. */
export const FolderAccessRuleSchema = closedObject({
  id: NonEmptyString,
  /** Root-relative folder path, `""` at the root. */
  folderPath: Type.String(),
  subjectKind: FolderRuleSubjectKindSchema,
  /** Role code, department slug, or profile id, per `subjectKind`. */
  subjectId: NonEmptyString,
  permission: FolderRulePermissionSchema,
  /** True when the rule also covers everything under the folder. */
  inherit: Type.Boolean(),
  note: Type.Optional(Type.String()),
  createdByProfileId: Type.Optional(NonEmptyString),
  createdAt: Type.Integer(),
  updatedAt: Type.Integer(),
});

/** One directory under the browsed folder, with the verdict that applies to it. */
export const FolderTreeEntrySchema = closedObject({
  name: NonEmptyString,
  /** Root-relative path, the only form this surface accepts back. */
  path: NonEmptyString,
  /** Absolute path, server-built, shown so an operator can recognize the folder. */
  absolutePath: NonEmptyString,
  permission: FolderRulePermissionSchema,
  /** True when the deciding rule sits on an ancestor rather than on this folder. */
  inherited: Type.Boolean(),
  /** Folder the deciding rule sits on. Absent when no rule matched at all. */
  sourcePath: Type.Optional(Type.String()),
  /** Rules attached to exactly this folder, so the tree can mark explicit settings. */
  ownRuleCount: Type.Integer({ minimum: 0 }),
});

/**
 * Browse one folder under the mount root.
 *
 * The preview pair lets an administrator see the tree as one subject would see it, which
 * is the only way to check that a `hidden` rule actually hides something without holding
 * that person's password. Preview never widens: a caller who may not manage rules gets
 * their own verdicts regardless of what they ask to preview.
 */
export const FoldersTreeListParamsSchema = closedObject({
  path: Type.Optional(Type.String()),
  previewSubjectKind: Type.Optional(FolderRuleSubjectKindSchema),
  previewSubjectId: Type.Optional(NonEmptyString),
});

export const FoldersTreeListResultSchema = closedObject({
  /** Absolute mount root the server resolved. */
  root: NonEmptyString,
  /** False when the root is not mounted here; `entries` is then empty. */
  available: Type.Boolean(),
  path: Type.String(),
  parent: Type.Optional(Type.String()),
  /** True when this caller may edit rules, which is also when hidden folders appear. */
  manage: Type.Boolean(),
  entries: Type.Array(FolderTreeEntrySchema),
});

/** The verdict for one subject on one folder, with the rule that produced it. */
export const FolderEffectiveRuleSchema = closedObject({
  subjectKind: FolderRuleSubjectKindSchema,
  subjectId: NonEmptyString,
  permission: FolderRulePermissionSchema,
  sourcePath: Type.String(),
  inherited: Type.Boolean(),
});

export const FoldersRulesListParamsSchema = closedObject({
  path: Type.Optional(Type.String()),
});

export const FoldersRulesListResultSchema = closedObject({
  root: NonEmptyString,
  path: Type.String(),
  /** False when the folder is gone from disk, which orphans every rule below. */
  exists: Type.Boolean(),
  /** Rules attached to exactly this folder. */
  rules: Type.Array(FolderAccessRuleSchema),
  /** Inheritable rules on ancestors, deepest first. */
  inherited: Type.Array(FolderAccessRuleSchema),
  /** Resolved verdict per subject named anywhere in the chain. */
  effective: Type.Array(FolderEffectiveRuleSchema),
});

/** Write one rule. Re-sending the same subject on the same folder replaces it. */
export const FoldersRulesSetParamsSchema = closedObject({
  path: Type.Optional(Type.String()),
  subjectKind: FolderRuleSubjectKindSchema,
  subjectId: NonEmptyString,
  permission: FolderRulePermissionSchema,
  /** Defaults to true: the common act is opening or closing a whole subtree. */
  inherit: Type.Optional(Type.Boolean()),
  note: Type.Optional(Type.String()),
  /**
   * Delete this subject's rules below the folder as part of the write.
   *
   * Leaving them would produce a tree the operator cannot explain: they applied a rule
   * to everything below and a few folders still differ.
   */
  applyToDescendants: Type.Optional(Type.Boolean()),
});

export const FoldersRulesSetResultSchema = closedObject({
  rule: FolderAccessRuleSchema,
  removedDescendants: Type.Integer({ minimum: 0 }),
});

export const FoldersRulesClearParamsSchema = closedObject({
  path: Type.Optional(Type.String()),
  subjectKind: FolderRuleSubjectKindSchema,
  subjectId: NonEmptyString,
});

export const FoldersRulesClearResultSchema = closedObject({
  removed: Type.Integer({ minimum: 0 }),
});

export const FolderSubjectDepartmentSchema = closedObject({
  slug: NonEmptyString,
  displayName: Type.Optional(NonEmptyString),
});

export const FolderSubjectUserSchema = closedObject({
  profileId: NonEmptyString,
  email: Type.Optional(NonEmptyString),
  displayName: Type.Optional(NonEmptyString),
});

/** The subjects a rule may name, so the editor never asks the operator to type an id. */
export const FoldersSubjectsListParamsSchema = closedObject({});

export const FoldersSubjectsListResultSchema = closedObject({
  roles: Type.Array(NonEmptyString),
  departments: Type.Array(FolderSubjectDepartmentSchema),
  users: Type.Array(FolderSubjectUserSchema),
});

export type FolderRuleSubjectKind = "role" | "department" | "user";

export type FolderRulePermission = "hidden" | "read" | "write";

export type FolderAccessRule = {
  id: string;
  folderPath: string;
  subjectKind: FolderRuleSubjectKind;
  subjectId: string;
  permission: FolderRulePermission;
  inherit: boolean;
  note?: string;
  createdByProfileId?: string;
  createdAt: number;
  updatedAt: number;
};

export type FolderTreeEntry = {
  name: string;
  path: string;
  absolutePath: string;
  permission: FolderRulePermission;
  inherited: boolean;
  sourcePath?: string;
  ownRuleCount: number;
};

export type FoldersTreeListParams = {
  path?: string;
  previewSubjectKind?: FolderRuleSubjectKind;
  previewSubjectId?: string;
};

export type FoldersTreeListResult = {
  root: string;
  available: boolean;
  path: string;
  parent?: string;
  manage: boolean;
  entries: FolderTreeEntry[];
};

export type FolderEffectiveRule = {
  subjectKind: FolderRuleSubjectKind;
  subjectId: string;
  permission: FolderRulePermission;
  sourcePath: string;
  inherited: boolean;
};

export type FoldersRulesListParams = {
  path?: string;
};

export type FoldersRulesListResult = {
  root: string;
  path: string;
  exists: boolean;
  rules: FolderAccessRule[];
  inherited: FolderAccessRule[];
  effective: FolderEffectiveRule[];
};

export type FoldersRulesSetParams = {
  path?: string;
  subjectKind: FolderRuleSubjectKind;
  subjectId: string;
  permission: FolderRulePermission;
  inherit?: boolean;
  note?: string;
  applyToDescendants?: boolean;
};

export type FoldersRulesSetResult = {
  rule: FolderAccessRule;
  removedDescendants: number;
};

export type FoldersRulesClearParams = {
  path?: string;
  subjectKind: FolderRuleSubjectKind;
  subjectId: string;
};

export type FoldersRulesClearResult = {
  removed: number;
};

export type FolderSubjectDepartment = {
  slug: string;
  displayName?: string;
};

export type FolderSubjectUser = {
  profileId: string;
  email?: string;
  displayName?: string;
};

export type FoldersSubjectsListParams = Record<string, never>;

export type FoldersSubjectsListResult = {
  roles: string[];
  departments: FolderSubjectDepartment[];
  users: FolderSubjectUser[];
};
