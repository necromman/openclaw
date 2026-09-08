// Gateway calls the department screen makes, in one place.
//
// Two kinds live here and they are not interchangeable. The binding and the folder
// listing are department methods the Gateway gates on the top rank. Saving an agent's
// access is an ordinary config write: it goes through `config.patch`, the same method and
// the same validation every other settings screen uses, so a value this screen writes is
// checked exactly as one typed into the config file would be.
import type {
  DepartmentsAgentsListResult,
  DepartmentsFoldersListResult,
} from "../../../../packages/gateway-protocol/src/schema/departments.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";

/** What one config write means for the running Gateway. */
export type DepartmentConfigWriteOutcome = "saved" | "restart-required" | "restart-scheduled";

export type DepartmentAgentAccessDraft = {
  agentId: string;
  /** Empty string clears the workspace and lets the agent fall back to its state dir. */
  workspace: string;
  /** True when the workspace sits under the shared folder root. */
  workspaceIsShared: boolean;
  readonlyTools: boolean;
  readonlySessions: boolean;
  indexPaths: string[];
};

export async function fetchDepartmentAgents(
  client: GatewayBrowserClient,
): Promise<DepartmentsAgentsListResult> {
  return client.request<DepartmentsAgentsListResult>("departments.agents.list", {});
}

export async function bindDepartmentAgent(params: {
  client: GatewayBrowserClient;
  agentId: string;
  department: string;
}): Promise<void> {
  await params.client.request("departments.agents.set", {
    agentId: params.agentId,
    ...(params.department ? { department: params.department } : {}),
  });
}

export async function fetchDepartmentFolders(params: {
  client: GatewayBrowserClient;
  path?: string;
}): Promise<DepartmentsFoldersListResult> {
  return params.client.request<DepartmentsFoldersListResult>(
    "departments.folders.list",
    params.path === undefined ? {} : { path: params.path },
  );
}

function readRestartOutcome(ack: unknown): DepartmentConfigWriteOutcome {
  if (ack === null || typeof ack !== "object") {
    return "saved";
  }
  // SAFETY: the null and typeof guard directly above proves this is an object.
  const record = ack as Record<string, unknown>;
  if (record.restart) {
    return "restart-scheduled";
  }
  const sentinel = record.sentinel;
  if (sentinel !== null && typeof sentinel === "object") {
    // SAFETY: the guard above proves sentinel is an object.
    const payload = (sentinel as Record<string, unknown>).payload;
    if (payload !== null && typeof payload === "object") {
      // SAFETY: the guard above proves payload is an object.
      const stats = (payload as Record<string, unknown>).stats;
      if (stats !== null && typeof stats === "object") {
        // SAFETY: the guard above proves stats is an object.
        return (stats as Record<string, unknown>).requiresRestart === true
          ? "restart-required"
          : "saved";
      }
    }
  }
  return "saved";
}

/**
 * Build the merge patch for one agent's access.
 *
 * `null` deletes a key, which is how a setting is returned to the deployment default
 * rather than pinned to a value that only looks like the default. `skipBootstrap` rides
 * along with a shared-root workspace because such a workspace is mounted read only, and
 * the first turn's bootstrap write into it fails the turn outright.
 */
export function buildDepartmentAgentPatch(draft: DepartmentAgentAccessDraft): string {
  const entry: Record<string, unknown> = {
    workspace: draft.workspace.length > 0 ? draft.workspace : null,
    skipBootstrap: draft.workspaceIsShared ? true : null,
    tools: {
      profile: draft.readonlyTools ? "readonly" : null,
      permissionMode: draft.readonlySessions ? "read-only" : null,
    },
    memory: { search: { extraPaths: draft.indexPaths } },
  };
  return JSON.stringify({ agents: { entries: { [draft.agentId]: entry } } });
}

/**
 * Save one agent's access.
 *
 * The base hash is read immediately before the write so a concurrent edit is refused by
 * the Gateway rather than silently overwritten. There is no retry: an operator who lost
 * the race should see what changed underneath them.
 */
/**
 * Take back the folders a deleted department had handed to its agents.
 *
 * One write per agent, in order: each config patch carries the hash it read, so batching
 * them would make every write after the first lose its own race. A single failure stops
 * the loop rather than being swallowed, because an agent left holding a workspace under a
 * department that no longer exists is exactly what this call is for.
 */
export async function clearDepartmentAgentAccess(params: {
  client: GatewayBrowserClient;
  agentIds: readonly string[];
}): Promise<void> {
  for (const agentId of params.agentIds) {
    await saveDepartmentAgentAccess({
      client: params.client,
      draft: {
        agentId,
        workspace: "",
        workspaceIsShared: false,
        readonlyTools: false,
        readonlySessions: false,
        indexPaths: [],
      },
    });
  }
}

export async function saveDepartmentAgentAccess(params: {
  client: GatewayBrowserClient;
  draft: DepartmentAgentAccessDraft;
}): Promise<DepartmentConfigWriteOutcome> {
  const snapshot = await params.client.request<{ hash?: string | null }>("config.get", {});
  const ack = await params.client.request("config.patch", {
    ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
    raw: buildDepartmentAgentPatch(params.draft),
    note: `departments: ${params.draft.agentId}`,
  });
  return readRestartOutcome(ack);
}
