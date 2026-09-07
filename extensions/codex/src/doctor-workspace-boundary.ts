/**
 * Reports agents that claim a workspace-only filesystem boundary while running
 * on the Codex runtime, whose read-only sandbox still grants filesystem-wide
 * read access to the shell commands the model issues.
 */
import { resolveDefaultModelForAgent } from "openclaw/plugin-sdk/agent-runtime";
import { listAgentIds, resolveAgentConfig } from "openclaw/plugin-sdk/agent-scope-runtime";
import { resolveEffectiveAgentRuntime } from "openclaw/plugin-sdk/command-auth-native";
import type { HealthCheck, HealthCheckContext, HealthFinding } from "openclaw/plugin-sdk/health";

export const CODEX_AGENT_WORKSPACE_BOUNDARY_CHECK_ID = "codex/agent-workspace-boundary";

type WorkspaceBoundaryAgent = {
  agentId: string;
  workspace?: string;
};

export type CodexWorkspaceBoundaryDependencies = {
  resolveRuntime?: typeof resolveEffectiveAgentRuntime;
};

/**
 * Collects agents whose configuration promises a workspace-only boundary that
 * the Codex runtime cannot keep. The pair that makes the promise explicit is a
 * read-only session permission mode plus an effective tools.fs.workspaceOnly.
 */
export function collectCodexWorkspaceBoundaryAgents(
  cfg: HealthCheckContext["cfg"],
  deps?: CodexWorkspaceBoundaryDependencies,
): WorkspaceBoundaryAgent[] {
  const resolveRuntime = deps?.resolveRuntime ?? resolveEffectiveAgentRuntime;
  const globalWorkspaceOnly = cfg.tools?.fs?.workspaceOnly;
  const affected: WorkspaceBoundaryAgent[] = [];
  for (const agentId of listAgentIds(cfg)) {
    const agent = resolveAgentConfig(cfg, agentId);
    const tools = agent?.tools;
    if (tools?.permissionMode !== "read-only") {
      continue;
    }
    if ((tools.fs?.workspaceOnly ?? globalWorkspaceOnly) !== true) {
      continue;
    }
    const model = resolveDefaultModelForAgent({ cfg, agentId });
    const runtime = resolveRuntime({
      cfg,
      provider: model.provider,
      modelId: model.model,
      agentId,
    });
    if (runtime !== "codex") {
      continue;
    }
    const workspace = agent?.workspace?.trim();
    affected.push({ agentId, ...(workspace ? { workspace } : {}) });
  }
  return affected;
}

function boundaryFinding(agent: WorkspaceBoundaryAgent): HealthFinding {
  return {
    checkId: CODEX_AGENT_WORKSPACE_BOUNDARY_CHECK_ID,
    severity: "warning",
    source: "codex",
    message:
      `Agent "${agent.agentId}" is configured read-only and workspace-only, but its model routes ` +
      "to the Codex runtime. That runtime answers file requests with shell commands under its own " +
      "read-only sandbox, which grants read access to the whole filesystem, so folders outside the " +
      "agent workspace stay readable.",
    ...(agent.workspace ? { path: agent.workspace } : {}),
    requirement: "a runtime that confines reads to the agent workspace",
    fixHint:
      "Give this agent a model whose credentials reach the native runtime, or drop the " +
      "workspace-only claim and treat every mounted folder as readable by the agent.",
  };
}

/** Builds the workspace-boundary health check for the Codex runtime. */
export function createCodexWorkspaceBoundaryHealthCheck(
  deps?: CodexWorkspaceBoundaryDependencies,
): HealthCheck {
  return {
    id: CODEX_AGENT_WORKSPACE_BOUNDARY_CHECK_ID,
    kind: "plugin",
    description: "Report workspace-only agents whose Codex runtime cannot enforce that boundary.",
    source: "codex",
    async detect(ctx) {
      return collectCodexWorkspaceBoundaryAgents(ctx.cfg, deps).map(boundaryFinding);
    },
  };
}
