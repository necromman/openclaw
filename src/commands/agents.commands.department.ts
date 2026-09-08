// Implements `openclaw agents department`: read and change agent-to-department bindings.
//
// Binding an agent is an operator act on the host, the same class as creating one, so it
// lives on the CLI rather than behind a Gateway method: a browser session that could
// rebind agents would be able to move the very fence that contains it.
import { listAgentIds } from "../agents/agent-scope-config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { type RuntimeEnv, writeRuntimeJson, defaultRuntime } from "../runtime.js";
import {
  clearDepartmentAgent,
  listDepartmentMembers,
  listDepartments,
  normalizeDepartmentSlug,
  readDepartmentAgentBindings,
  setDepartmentAgent,
} from "../state/departments-store.js";
import { requireValidConfig } from "./config-validation.js";

export type AgentsDepartmentOptions = {
  agent?: string;
  set?: string;
  clear?: boolean;
  json?: boolean;
};

function renderText(params: {
  bindings: ReadonlyMap<string, string>;
  departments: ReadonlyArray<{ slug: string; members: number }>;
  agentIds: readonly string[];
}): string[] {
  const lines: string[] = ["Departments:"];
  if (params.departments.length === 0) {
    lines.push("  (none yet - a department appears once someone with that group signs in)");
  }
  for (const department of params.departments) {
    const agents = [...params.bindings.entries()]
      .filter(([, slug]) => slug === department.slug)
      .map(([agentId]) => agentId);
    lines.push(
      `  ${department.slug}  members=${department.members}  agents=${agents.length > 0 ? agents.join(", ") : "-"}`,
    );
  }
  const shared = params.agentIds.filter((agentId) => !params.bindings.has(agentId));
  lines.push("");
  lines.push(
    `Shared agents (no department; sessions stay private to their creator): ${shared.length > 0 ? shared.join(", ") : "-"}`,
  );
  const stale = [...params.bindings.keys()].filter((agentId) => !params.agentIds.includes(agentId));
  if (stale.length > 0) {
    lines.push("");
    lines.push(
      `Bindings for agents no longer configured (clear them): ${stale.join(", ")}`,
    );
  }
  return lines;
}

/** Read or change which department an agent belongs to. */
export async function agentsDepartmentCommand(
  opts: AgentsDepartmentOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }
  const agentId = opts.agent ? normalizeAgentId(opts.agent) : undefined;
  if (opts.set !== undefined || opts.clear === true) {
    if (!agentId) {
      runtime.error("--agent is required when changing a binding");
      runtime.exit(1);
      return;
    }
    // Clearing is also how a binding left behind by a removed agent is cleaned up, so it
    // is allowed for an id the config no longer names. Binding is not: pointing a
    // department at an agent that does not exist would look done and do nothing.
    const configured = listAgentIds(cfg).includes(agentId);
    const bound = readDepartmentAgentBindings().has(agentId);
    if (!configured && !(opts.clear === true && bound)) {
      runtime.error(`unknown agent "${agentId}"; run "openclaw agents list" to see configured ids`);
      runtime.exit(1);
      return;
    }
    if (opts.clear === true) {
      clearDepartmentAgent(agentId);
    } else {
      const slug = normalizeDepartmentSlug(opts.set ?? "");
      if (!slug) {
        runtime.error("--set requires a department slug");
        runtime.exit(1);
        return;
      }
      setDepartmentAgent({ agentId, departmentSlug: slug, nowMs: Date.now() });
    }
  }

  const bindings = readDepartmentAgentBindings();
  const departments = listDepartments().map((row) => ({
    slug: row.slug,
    members: listDepartmentMembers(row.slug).length,
  }));
  const agentIds = listAgentIds(cfg);
  if (opts.json) {
    writeRuntimeJson(runtime, {
      departments: departments.map((department) => ({
        ...department,
        agents: agentIds.filter((id) => bindings.get(id) === department.slug),
      })),
      agents: agentIds.map((id) => ({ id, department: bindings.get(id) ?? null })),
      // Rows whose agent the config no longer names. They bind nothing today, but an
      // agent later created with the same id would silently inherit the old department.
      staleBindings: [...bindings.entries()]
        .filter(([id]) => !agentIds.includes(id))
        .map(([id, department]) => ({ id, department })),
    });
    return;
  }
  for (const line of renderText({ bindings, departments, agentIds })) {
    runtime.log(line);
  }
}
