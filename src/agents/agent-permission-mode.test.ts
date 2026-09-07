/**
 * Coverage for the config-declared session permission ceiling.
 * Verifies entry/defaults resolution and the widen-needs-admin rule.
 */
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  isPermissionModeWider,
  resolveAgentDefaultPermissionMode,
  resolveRequestedSessionPermissionMode,
} from "./agent-permission-mode.js";

function configWith(agents: NonNullable<OpenClawConfig["agents"]>): OpenClawConfig {
  return { agents } as OpenClawConfig;
}

const readOnlyAgents = configWith({
  entries: {
    "rnd-bot": { tools: { profile: "readonly", permissionMode: "read-only" } },
    "free-bot": {},
  },
});

describe("resolveAgentDefaultPermissionMode", () => {
  it("reads the agent entry mode", () => {
    expect(resolveAgentDefaultPermissionMode(readOnlyAgents, "rnd-bot")).toBe("read-only");
  });

  it("falls back to agents.defaults.tools.permissionMode", () => {
    const cfg = configWith({
      defaults: { tools: { permissionMode: "guarded" } },
      entries: { "rnd-bot": { tools: { permissionMode: "read-only" } }, "free-bot": {} },
    });
    expect(resolveAgentDefaultPermissionMode(cfg, "free-bot")).toBe("guarded");
    expect(resolveAgentDefaultPermissionMode(cfg, "rnd-bot")).toBe("read-only");
  });

  it("returns undefined without config or a configured mode", () => {
    expect(resolveAgentDefaultPermissionMode(undefined, "rnd-bot")).toBeUndefined();
    expect(resolveAgentDefaultPermissionMode(readOnlyAgents, "free-bot")).toBeUndefined();
    expect(resolveAgentDefaultPermissionMode(readOnlyAgents, "missing-bot")).toBeUndefined();
  });
});

describe("isPermissionModeWider", () => {
  it("orders the four modes", () => {
    expect(isPermissionModeWider("guarded", "read-only")).toBe(true);
    expect(isPermissionModeWider("workspace", "guarded")).toBe(true);
    expect(isPermissionModeWider("full", "workspace")).toBe(true);
    expect(isPermissionModeWider("read-only", "full")).toBe(false);
    expect(isPermissionModeWider("guarded", "guarded")).toBe(false);
  });
});

describe("resolveRequestedSessionPermissionMode", () => {
  it("applies the configured ceiling when the caller names no mode", () => {
    expect(resolveRequestedSessionPermissionMode(readOnlyAgents, "rnd-bot", undefined)).toEqual({
      mode: "read-only",
      needsAdminScope: false,
    });
  });

  it("leaves an unconfigured agent without a mode", () => {
    expect(resolveRequestedSessionPermissionMode(readOnlyAgents, "free-bot", undefined)).toEqual({
      mode: undefined,
      needsAdminScope: false,
    });
  });

  it("lets a caller narrow past the ceiling without the admin scope", () => {
    const cfg = configWith({ entries: { "qa-bot": { tools: { permissionMode: "workspace" } } } });
    expect(resolveRequestedSessionPermissionMode(cfg, "qa-bot", "read-only")).toEqual({
      mode: "read-only",
      needsAdminScope: false,
    });
    expect(resolveRequestedSessionPermissionMode(cfg, "qa-bot", "workspace")).toEqual({
      mode: "workspace",
      needsAdminScope: false,
    });
  });

  it("requires the admin scope to widen past the ceiling", () => {
    expect(resolveRequestedSessionPermissionMode(readOnlyAgents, "rnd-bot", "guarded")).toEqual({
      mode: "guarded",
      needsAdminScope: true,
    });
    expect(resolveRequestedSessionPermissionMode(readOnlyAgents, "rnd-bot", "workspace")).toEqual({
      mode: "workspace",
      needsAdminScope: true,
    });
  });

  it("keeps full admin-only where no ceiling is configured", () => {
    expect(resolveRequestedSessionPermissionMode(readOnlyAgents, "free-bot", "full")).toEqual({
      mode: "full",
      needsAdminScope: true,
    });
    expect(resolveRequestedSessionPermissionMode(readOnlyAgents, "free-bot", "workspace")).toEqual({
      mode: "workspace",
      needsAdminScope: false,
    });
  });
});
