import type { OpenClawConfig } from "openclaw/plugin-sdk/health";
import { describe, expect, it } from "vitest";
import {
  CODEX_AGENT_WORKSPACE_BOUNDARY_CHECK_ID,
  collectCodexWorkspaceBoundaryAgents,
  createCodexWorkspaceBoundaryHealthCheck,
} from "./doctor-workspace-boundary.js";

const codexRuntime = () => "codex";
const nativeRuntime = () => "openai";

function config(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    tools: { fs: { workspaceOnly: true } },
    agents: {
      defaults: { model: { primary: "openai/gpt-5.6-sol" } },
      entries: {
        main: {},
        "rnd-bot": {
          workspace: "/mnt/nas/rnd",
          tools: { profile: "readonly", permissionMode: "read-only" },
        },
      },
    },
    ...overrides,
  } as OpenClawConfig;
}

describe("codex workspace boundary check", () => {
  it("reports a read-only workspace-only agent that routes to the codex runtime", () => {
    const affected = collectCodexWorkspaceBoundaryAgents(config(), {
      resolveRuntime: codexRuntime,
    });
    expect(affected).toEqual([{ agentId: "rnd-bot", workspace: "/mnt/nas/rnd" }]);
  });

  it("stays silent when the agent routes to a runtime that keeps the boundary", () => {
    expect(
      collectCodexWorkspaceBoundaryAgents(config(), { resolveRuntime: nativeRuntime }),
    ).toEqual([]);
  });

  it("stays silent without a read-only permission mode", () => {
    const cfg = config({
      agents: {
        entries: {
          "rnd-bot": { workspace: "/mnt/nas/rnd", tools: { profile: "readonly" } },
        },
      },
    } as Partial<OpenClawConfig>);
    expect(collectCodexWorkspaceBoundaryAgents(cfg, { resolveRuntime: codexRuntime })).toEqual([]);
  });

  it("stays silent when no workspace-only boundary is claimed", () => {
    const cfg = config({ tools: { fs: { workspaceOnly: false } } } as Partial<OpenClawConfig>);
    expect(collectCodexWorkspaceBoundaryAgents(cfg, { resolveRuntime: codexRuntime })).toEqual([]);
  });

  it("honours an agent-level workspaceOnly override over the global default", () => {
    const cfg = config({
      tools: { fs: { workspaceOnly: false } },
      agents: {
        entries: {
          "rnd-bot": {
            workspace: "/mnt/nas/rnd",
            tools: {
              profile: "readonly",
              permissionMode: "read-only",
              fs: { workspaceOnly: true },
            },
          },
        },
      },
    } as Partial<OpenClawConfig>);
    expect(collectCodexWorkspaceBoundaryAgents(cfg, { resolveRuntime: codexRuntime })).toEqual([
      { agentId: "rnd-bot", workspace: "/mnt/nas/rnd" },
    ]);
  });

  it("emits one warning finding per affected agent", async () => {
    const check = createCodexWorkspaceBoundaryHealthCheck({ resolveRuntime: codexRuntime });
    const findings = await check.detect({ cfg: config() } as never);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.checkId).toBe(CODEX_AGENT_WORKSPACE_BOUNDARY_CHECK_ID);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.path).toBe("/mnt/nas/rnd");
    expect(findings[0]?.message).toContain("whole filesystem");
  });
});
