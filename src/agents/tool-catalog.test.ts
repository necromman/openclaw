/**
 * Regression coverage for core tool catalog profile defaults.
 * Verifies built-in profile allowlists include expected core tool groups.
 */
import { describe, expect, it } from "vitest";
import { listCoreToolSections, resolveCoreToolProfilePolicy } from "./tool-catalog.js";

function requireCoreToolProfilePolicy(profile: Parameters<typeof resolveCoreToolProfilePolicy>[0]) {
  const policy = resolveCoreToolProfilePolicy(profile);
  if (!policy) {
    throw new Error(`expected ${profile} tool profile policy`);
  }
  return policy;
}

function requirePolicyAllow(profile: Parameters<typeof resolveCoreToolProfilePolicy>[0]) {
  const allow = requireCoreToolProfilePolicy(profile).allow;
  if (!allow) {
    throw new Error(`expected ${profile} tool profile allow list`);
  }
  return allow;
}

describe("tool-catalog", () => {
  it("lists agents_wait only for a Swarm-enabled catalog", () => {
    const ids = (config?: Parameters<typeof listCoreToolSections>[0]) =>
      listCoreToolSections(config).flatMap((section) => section.tools.map((tool) => tool.id));

    expect(ids()).not.toContain("agents_wait");
    expect(ids({ swarmEnabled: true })).toContain("agents_wait");
  });

  it("lists GitHub publication only with a prepared session capability", () => {
    const ids = (config?: Parameters<typeof listCoreToolSections>[0]) =>
      listCoreToolSections(config).flatMap((section) => section.tools.map((tool) => tool.id));

    expect(ids()).not.toContain("github_publish");
    expect(ids()).not.toContain("github_identity_status");
    expect(ids({ githubPublicationAvailable: false })).toContain("github_identity_status");
    expect(ids({ githubPublicationAvailable: true })).toContain("github_publish");
  });

  it("includes code execution, web tools, and progress_card in the coding profile policy", () => {
    const policy = requireCoreToolProfilePolicy("coding");
    expect(policy.allow).toEqual([
      "read",
      "write",
      "edit",
      "apply_patch",
      "exec",
      "process",
      "code_execution",
      "secrets",
      "web_search",
      "web_fetch",
      "x_search",
      "memory_search",
      "memory_get",
      "sessions",
      "sessions_list",
      "sessions_history",
      "sessions_search",
      "conversations_list",
      "conversations_send",
      "conversations_turn",
      "sessions_send",
      "sessions_spawn",
      "github_identity_status",
      "github_publish",
      "agents_wait",
      "sessions_yield",
      "subagents",
      "session_status",
      "suggest_task",
      "dismiss_task",
      "screen",
      "dashboard",
      "terminal",
      "portal",
      "automations",
      "get_goal",
      "create_goal",
      "update_goal",
      "progress_card",
      "ask_user",
      "skill_workshop",
      "view_image",
      "media_list",
      "media_read",
      "image_generate",
      "music_generate",
      "video_generate",
      "bundle-mcp",
    ]);
  });

  it("includes bundle MCP tools in coding and messaging profile policies", () => {
    expect(requirePolicyAllow("coding").at(-1)).toBe("bundle-mcp");
    expect(requirePolicyAllow("messaging")).toEqual([
      "secrets",
      "sessions",
      "sessions_list",
      "sessions_history",
      "sessions_search",
      "conversations_list",
      "conversations_send",
      "conversations_turn",
      "sessions_send",
      "sessions_spawn",
      "sessions_yield",
      "subagents",
      "session_status",
      "message",
      "ask_user",
      "media_list",
      "media_read",
      "bundle-mcp",
    ]);
    expect(requirePolicyAllow("minimal")).toEqual(["session_status"]);
  });

  it("keeps the readonly profile to lookup tools and excludes bundle MCP", () => {
    expect(requirePolicyAllow("readonly")).toEqual([
      "read",
      "web_search",
      "web_fetch",
      "memory_search",
      "memory_get",
      "session_status",
      "view_image",
      "media_list",
      "media_read",
    ]);
  });

  it("omits every mutating tool from the readonly profile", () => {
    const allow = new Set(requirePolicyAllow("readonly"));
    for (const denied of [
      "write",
      "edit",
      "apply_patch",
      "exec",
      "process",
      "code_execution",
      "secrets",
      "terminal",
      "browser",
      "computer",
      "message",
      "automations",
      "gateway",
      "sessions_send",
      "sessions_spawn",
      "image_generate",
      "bundle-mcp",
    ]) {
      expect(allow.has(denied), `readonly must not allow ${denied}`).toBe(false);
    }
  });

  it("keeps the readonly profile an opt-in allowlist so later tools stay out", () => {
    // Guards the profile against silent growth: a tool joins only by naming
    // "readonly" in its catalog entry, so a new catalog row is excluded by default.
    const allow = new Set(requirePolicyAllow("readonly"));
    const codingOnly = requirePolicyAllow("coding").filter((id) => !allow.has(id));
    expect(codingOnly.length).toBeGreaterThan(0);
    expect(allow.size).toBeLessThan(requirePolicyAllow("coding").length);
  });

  it("full profile uses wildcard to grant all tools (#76507)", () => {
    const policy = requireCoreToolProfilePolicy("full");
    expect(policy.allow).toEqual(["*"]);
  });
});
