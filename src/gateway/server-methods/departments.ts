// Department administration over the Gateway connection.
//
// `openclaw agents department` already owns the binding, and this reuses its store
// functions rather than growing a second writer: the CLI and this method mutate exactly
// the same row, so an operator who binds an agent on the host and an operator who binds
// it from the screen cannot end up with different answers.
//
// Why this is here at all, when AUTH-DEPARTMENTS 7 argues the binding belongs on the
// host: the reasoning there is that a browser session which could move the fence is not a
// fence. That still holds for everyone the fence contains. The super-administrator is not
// contained by it (rule 1 in that document's table: no gate is built for them), so
// letting *that* account rebind agents removes nothing it did not already have. The gate
// below is what keeps the difference real, and it is deliberately stricter than the
// operator scope in the descriptor table: a scope says what a connection may call, and a
// rank says who is calling.
import {
  ErrorCodes,
  errorShape,
  validateDepartmentsAgentsListParams,
  validateDepartmentsAgentsSetParams,
  validateDepartmentsFoldersListParams,
  type DepartmentAgent,
  type DepartmentSummary,
} from "../../../packages/gateway-protocol/src/index.js";
import { listAgentEntries } from "../../agents/agent-scope-config.js";
import { recordUserActivity } from "../../audit/user-activity-audit-recorder.js";
import { normalizeAgentIdStrict } from "../../routing/session-key.js";
import {
  clearDepartmentAgent,
  listDepartmentMembers,
  listDepartments,
  normalizeDepartmentSlug,
  readDepartmentAgentBindings,
  setDepartmentAgent,
} from "../../state/departments-store.js";
import {
  isDepartmentFolderRejection,
  listDepartmentFolders,
  resolveDepartmentFolderRoot,
} from "../department-folder-listing.js";
import { clientActivityActor, readClientAuditActor } from "../ix-auth-audit-actor.js";
import { ADMIN_SCOPE } from "../operator-scopes.js";
import type { GatewayClient } from "./client-types.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

/** A department slug: lowercase, digits and single hyphens, short enough to read. */
const DEPARTMENT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

/**
 * May this connection administer departments.
 *
 * Two callers pass. A connection carrying a verified identity passes only when that
 * identity is a super-administrator, which is the same test the department fence itself
 * uses (`isSuperAdmin`, never a scope, so a widened scope cannot open the fence). A
 * connection carrying no identity at all is the host: the CLI on the Gateway machine or
 * an operator token, which already owns the SQLite file this method writes, and which the
 * `operator.admin` scope in the descriptor table has already gated.
 */
export function mayAdministerDepartments(client: GatewayClient | null): boolean {
  const actor = readClientAuditActor(client);
  if (actor) {
    return actor.isSuperAdmin === true;
  }
  const scopes = Array.isArray(client?.connect.scopes) ? client.connect.scopes : [];
  return scopes.includes(ADMIN_SCOPE);
}

function respondForbidden(respond: RespondFn): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.FORBIDDEN, "Only a system administrator can manage departments."),
  );
}

/** Every configured agent, with the settings that decide what it can reach. */
function readDepartmentAgents(
  cfg: Parameters<typeof listAgentEntries>[0],
  bindings: ReadonlyMap<string, string>,
): DepartmentAgent[] {
  return listAgentEntries(cfg).map((entry) => {
    const department = bindings.get(entry.id);
    // An extra path is either a bare folder or a folder with a glob. The screen shows
    // folders, so the glob form is reduced to the folder it sits under.
    const extraPaths = (entry.memory?.search?.extraPaths ?? []).map((value) =>
      typeof value === "string" ? value : value.path,
    );
    return {
      agentId: entry.id,
      ...(entry.name ? { name: entry.name } : {}),
      ...(department ? { department } : {}),
      ...(entry.workspace ? { workspace: entry.workspace } : {}),
      ...(entry.tools?.profile ? { toolsProfile: entry.tools.profile } : {}),
      ...(entry.tools?.permissionMode ? { permissionMode: entry.tools.permissionMode } : {}),
      indexPaths: extraPaths.filter((value) => value.length > 0),
      ...(entry.skipBootstrap === undefined ? {} : { skipBootstrap: entry.skipBootstrap }),
    };
  });
}

/**
 * Departments as the fork's own store holds them.
 *
 * `memberCount` counts the projection, which a person joins on their next sign-in rather
 * than the moment a group changes. The identity server stays canonical for membership;
 * this number answers "who has actually been seen in this department", which is the
 * question an operator looking at a binding is really asking.
 */
function readDepartmentSummaries(bindings: ReadonlyMap<string, string>): DepartmentSummary[] {
  return listDepartments().map((row) => ({
    slug: row.slug,
    displayName: row.display_name,
    memberCount: listDepartmentMembers(row.slug).length,
    agents: [...bindings.entries()]
      .filter(([, slug]) => slug === row.slug)
      .map(([agentId]) => agentId),
  }));
}

export const departmentsHandlers: GatewayRequestHandlers = {
  "departments.agents.list": ({ params, respond, context, client }) => {
    if (
      !assertValidParams(
        params,
        validateDepartmentsAgentsListParams,
        "departments.agents.list",
        respond,
      )
    ) {
      return;
    }
    if (!mayAdministerDepartments(client)) {
      respondForbidden(respond);
      return;
    }
    const bindings = readDepartmentAgentBindings();
    respond(true, {
      agents: readDepartmentAgents(context.getRuntimeConfig(), bindings),
      departments: readDepartmentSummaries(bindings),
    });
  },

  "departments.agents.set": ({ params, respond, context, client }) => {
    if (
      !assertValidParams(
        params,
        validateDepartmentsAgentsSetParams,
        "departments.agents.set",
        respond,
      )
    ) {
      return;
    }
    if (!mayAdministerDepartments(client)) {
      respondForbidden(respond);
      return;
    }
    const normalized = normalizeAgentIdStrict(params.agentId);
    const cfg = context.getRuntimeConfig();
    const known = new Set(listAgentEntries(cfg).map((entry) => entry.id));
    if (!normalized.ok || !known.has(normalized.value)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent "${params.agentId}" not found`),
      );
      return;
    }
    const agentId = normalized.value;
    const requested = params.department?.trim() ?? "";
    if (requested.length === 0) {
      clearDepartmentAgent(agentId);
      recordDepartmentBinding({ client, agentId });
      respond(true, { agentId });
      return;
    }
    const slug = normalizeDepartmentSlug(requested);
    if (!DEPARTMENT_SLUG_PATTERN.test(slug)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid department slug "${requested}"`),
      );
      return;
    }
    setDepartmentAgent({ agentId, departmentSlug: slug, nowMs: Date.now() });
    recordDepartmentBinding({ client, agentId, department: slug });
    respond(true, { agentId, department: slug });
  },

  "departments.folders.list": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateDepartmentsFoldersListParams,
        "departments.folders.list",
        respond,
      )
    ) {
      return;
    }
    if (!mayAdministerDepartments(client)) {
      respondForbidden(respond);
      return;
    }
    const { root, available } = await resolveDepartmentFolderRoot();
    const listing = await listDepartmentFolders({
      root,
      available,
      ...(params.path === undefined ? {} : { path: params.path }),
    });
    if (isDepartmentFolderRejection(listing)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "path is outside the shared folder root"),
      );
      return;
    }
    respond(true, listing);
  },
};

/** One ledger row per binding change, attributed to whoever made it. */
function recordDepartmentBinding(params: {
  client: GatewayClient | null;
  agentId: string;
  department?: string;
}): void {
  recordUserActivity({
    kind: "admin_action",
    actor: clientActivityActor(params.client),
    agentId: params.agentId,
    detail: {
      action: "department-agent-binding",
      agentId: params.agentId,
      department: params.department ?? null,
    },
  });
}
