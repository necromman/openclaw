/**
 * Coverage for the configured agent permission ceiling on session patches.
 * sessions.patch and sessions.patchMany may narrow freely; widening past
 * agents.entries.<id>.tools.permissionMode needs the operator admin scope.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadSessionEntry,
  upsertSessionEntryCore,
} from "../../config/sessions/session-accessor.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { trackAsyncWork } from "../../shared/async-work-scope.js";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import { withOpenClawTestState } from "../../test-utils/openclaw-test-state.js";
import { flushPendingSessionsChangedEvents } from "./session-change-event.js";
import { sessionMutationHandlers } from "./sessions-mutations.js";
import type { GatewayClient, GatewayRequestContext } from "./types.js";

afterEach(() => {
  flushPendingSessionsChangedEvents();
  closeOpenClawAgentDatabasesForTest();
  vi.restoreAllMocks();
});

const READ_ONLY_AGENT_CONFIG = {
  agents: { entries: { main: { tools: { permissionMode: "read-only" } } } },
} as OpenClawConfig;

function client(scopes: string[]): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: { id: "test", version: "1", platform: "test", mode: "webchat" },
      role: "operator",
      scopes,
    },
  } as GatewayClient;
}

function context(cfg: OpenClawConfig) {
  return {
    trackExecution: trackAsyncWork,
    getRuntimeConfig: () => cfg,
    getSessionEventSubscriberConnIds: () => new Set<string>(),
    broadcastToConnIds: vi.fn(),
    chatAbortControllers: new Map(),
  } as unknown as GatewayRequestContext;
}

function missingAdminScope() {
  return expect.objectContaining({
    details: expect.objectContaining({ requiredScopes: ["operator.admin"] }),
  });
}

describe("agent permission ceiling", () => {
  it("rejects a sessions.patch that widens past the configured ceiling", async () => {
    const respond = vi.fn();
    await sessionMutationHandlers["sessions.patch"]!({
      params: { key: "agent:main:ceiling-widen", permissionMode: "workspace" },
      client: client(["operator.write"]),
      context: context(READ_ONLY_AGENT_CONFIG),
      respond,
    } as never);
    expect(respond).toHaveBeenCalledWith(false, undefined, missingAdminScope());
  });

  it("accepts the same widening from an admin-scoped client", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async (state) => {
      const sessionKey = "agent:main:ceiling-widen-admin";
      await upsertSessionEntryCore(
        { agentId: "main", env: state.env, sessionKey },
        { sessionId: "ceiling-widen-admin", updatedAt: 1, permissionMode: "read-only" },
      );
      const respond = vi.fn();
      await sessionMutationHandlers["sessions.patch"]!({
        params: { key: sessionKey, permissionMode: "workspace" },
        client: client(["operator.write", "operator.admin"]),
        context: context(READ_ONLY_AGENT_CONFIG),
        respond,
      } as never);
      expect(respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
      expect(loadSessionEntry({ agentId: "main", env: state.env, sessionKey })).toMatchObject({
        permissionMode: "workspace",
      });
    });
  });

  it("lets a non-admin narrow to the ceiling", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async (state) => {
      const sessionKey = "agent:main:ceiling-narrow";
      await upsertSessionEntryCore(
        { agentId: "main", env: state.env, sessionKey },
        { sessionId: "ceiling-narrow", updatedAt: 1, permissionMode: "guarded" },
      );
      const respond = vi.fn();
      await sessionMutationHandlers["sessions.patch"]!({
        params: { key: sessionKey, permissionMode: "read-only" },
        client: client(["operator.write"]),
        context: context(READ_ONLY_AGENT_CONFIG),
        respond,
      } as never);
      expect(respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
      expect(loadSessionEntry({ agentId: "main", env: state.env, sessionKey })).toMatchObject({
        permissionMode: "read-only",
      });
    });
  });

  it("keeps full admin-only where no ceiling is configured", async () => {
    const respond = vi.fn();
    await sessionMutationHandlers["sessions.patch"]!({
      params: { key: "agent:main:no-ceiling", permissionMode: "full" },
      client: client(["operator.write"]),
      context: context({} as OpenClawConfig),
      respond,
    } as never);
    expect(respond).toHaveBeenCalledWith(false, undefined, missingAdminScope());
  });

  it("rejects a sessions.patchMany that widens past any target ceiling", async () => {
    const respond = vi.fn();
    await sessionMutationHandlers["sessions.patchMany"]!({
      params: {
        targets: [{ key: "agent:main:ceiling-many-a" }, { key: "agent:main:ceiling-many-b" }],
        patch: { permissionMode: "guarded" },
      },
      client: client(["operator.write"]),
      context: context(READ_ONLY_AGENT_CONFIG),
      respond,
    } as never);
    expect(respond).toHaveBeenCalledWith(false, undefined, missingAdminScope());
  });
});
