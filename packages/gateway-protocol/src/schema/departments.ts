// Gateway Protocol schema module for the department administration surface.
//
// Three questions live here, and they are deliberately separate from the identity
// server's own department list (`/auth/admin/departments`): who an agent belongs to,
// what an agent is currently allowed to reach, and which shared folders exist under the
// mount root. The first two are fork-owned state, the third is host filesystem truth.
//
// The folder listing carries relative paths only. An absolute path on the wire would
// invite a caller to name one, and the whole point of the root is that the server, not
// the browser, decides what "inside" means.
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

/** One configured agent, with the settings that decide what it may reach. */
export const DepartmentAgentSchema = closedObject({
  agentId: NonEmptyString,
  name: Type.Optional(NonEmptyString),
  /** Department slug this agent is bound to. Absent means shared (bound to none). */
  department: Type.Optional(NonEmptyString),
  /** Configured workspace, which is the agent's one allowed folder. */
  workspace: Type.Optional(NonEmptyString),
  /** `tools.profile`, `"readonly"` for a file-server agent. */
  toolsProfile: Type.Optional(NonEmptyString),
  /** `tools.permissionMode`, `"read-only"` for a file-server agent. */
  permissionMode: Type.Optional(NonEmptyString),
  /** `memory.search.extraPaths`: the Markdown index folders this agent searches. */
  indexPaths: Type.Array(NonEmptyString),
  /** `skipBootstrap`, which a read-only workspace requires. */
  skipBootstrap: Type.Optional(Type.Boolean()),
});

/** One department as the fork's own store knows it. */
export const DepartmentSummarySchema = closedObject({
  slug: NonEmptyString,
  displayName: NonEmptyString,
  /** Members projected at sign-in, not the identity server's live count. */
  memberCount: Type.Integer({ minimum: 0 }),
  agents: Type.Array(NonEmptyString),
});

export const DepartmentsAgentsListParamsSchema = closedObject({});

export const DepartmentsAgentsListResultSchema = closedObject({
  agents: Type.Array(DepartmentAgentSchema),
  departments: Type.Array(DepartmentSummarySchema),
});

/** Bind one agent to one department, or omit the slug to return it to the shared pool. */
export const DepartmentsAgentsSetParamsSchema = closedObject({
  agentId: NonEmptyString,
  department: Type.Optional(NonEmptyString),
});

export const DepartmentsAgentsSetResultSchema = closedObject({
  agentId: NonEmptyString,
  department: Type.Optional(NonEmptyString),
});

/** One directory directly under the browsed folder. */
export const DepartmentFolderEntrySchema = closedObject({
  name: NonEmptyString,
  /** Root-relative path, the only form this surface accepts back. */
  path: NonEmptyString,
  /** Absolute path to put in an agent's `workspace`. Server-built, never client-sent. */
  absolutePath: NonEmptyString,
});

/** Browse one folder under the mount root. An absent path means the root itself. */
export const DepartmentsFoldersListParamsSchema = closedObject({
  path: Type.Optional(Type.String()),
});

export const DepartmentsFoldersListResultSchema = closedObject({
  /** Absolute mount root the server resolved. Shown so an operator can see it. */
  root: NonEmptyString,
  /** False when the root is not mounted here; `entries` is then empty. */
  available: Type.Boolean(),
  /** Root-relative path actually listed, `""` at the root. */
  path: Type.String(),
  /** Root-relative parent, absent at the root. */
  parent: Type.Optional(Type.String()),
  entries: Type.Array(DepartmentFolderEntrySchema),
});

export type DepartmentAgent = {
  agentId: string;
  name?: string;
  department?: string;
  workspace?: string;
  toolsProfile?: string;
  permissionMode?: string;
  indexPaths: string[];
  skipBootstrap?: boolean;
};

export type DepartmentSummary = {
  slug: string;
  displayName: string;
  memberCount: number;
  agents: string[];
};

export type DepartmentsAgentsListParams = Record<string, never>;

export type DepartmentsAgentsListResult = {
  agents: DepartmentAgent[];
  departments: DepartmentSummary[];
};

export type DepartmentsAgentsSetParams = {
  agentId: string;
  department?: string;
};

export type DepartmentsAgentsSetResult = {
  agentId: string;
  department?: string;
};

export type DepartmentFolderEntry = {
  name: string;
  path: string;
  absolutePath: string;
};

export type DepartmentsFoldersListParams = {
  path?: string;
};

export type DepartmentsFoldersListResult = {
  root: string;
  available: boolean;
  path: string;
  parent?: string;
  entries: DepartmentFolderEntry[];
};
