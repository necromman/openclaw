import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { readDepartmentAgentBindings } from "../../state/departments-store.js";
import { departmentsHandlers, mayAdministerDepartments } from "./departments.js";
import type { GatewayClient } from "./client-types.js";
import type { GatewayRequestHandlerOptions } from "./shared-types.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

/** A configured roster the handlers can read without a real config file. */
const CONFIG = {
  agents: {
    entries: {
      "rnd-bot": {
        name: "RND Bot",
        workspace: "/mnt/nas/rnd",
        tools: { profile: "readonly", permissionMode: "read-only" },
        memory: { search: { extraPaths: ["/mnt/knowledge/rnd"] } },
        skipBootstrap: true,
      },
      main: {},
    },
  },
};

/**
 * One connection, described by what it proved rather than by what it claims.
 *
 * `ixAuthAuditActor` is minted only from a verified token at handshake time, so a test
 * that sets it is describing a real sign-in, and one that leaves it out is describing the
 * host: the CLI or an operator token with no identity server in the picture.
 */
function client(params: {
  scopes?: string[];
  identity?: { isSuperAdmin: boolean };
}): GatewayClient {
  return {
    connect: { scopes: params.scopes ?? [] },
    internal: params.identity
      ? {
          ixAuthAuditActor: {
            profileId: "profile-1",
            email: "admin@example.test",
            departments: [],
            isSuperAdmin: params.identity.isSuperAdmin,
          },
        }
      : {},
    // SAFETY: the handlers under test read only connect.scopes and internal.
  } as unknown as GatewayClient;
}

type Answer = { ok: boolean; result?: unknown; error?: { code?: string; message?: string } };

async function callMethod(params: {
  method: string;
  params?: Record<string, unknown>;
  client: GatewayClient | null;
}): Promise<Answer> {
  const handler = departmentsHandlers[params.method];
  if (!handler) {
    throw new Error(`no handler for ${params.method}`);
  }
  const answer: Answer = { ok: false };
  await handler({
    params: params.params ?? {},
    client: params.client,
    respond: (ok: boolean, result?: unknown, error?: unknown) => {
      answer.ok = ok;
      answer.result = result;
      // SAFETY: the error shape carries code and message; only those are read here.
      answer.error = error as Answer["error"];
    },
    context: { getRuntimeConfig: () => CONFIG },
    // SAFETY: the handlers under test read only params, client, respond and context.
  } as unknown as GatewayRequestHandlerOptions);
  return answer;
}

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("openclaw-departments-rpc-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  closeOpenClawStateDatabaseForTest();
});

describe("department administration authority", () => {
  it("admits a signed-in system administrator", () => {
    expect(mayAdministerDepartments(client({ identity: { isSuperAdmin: true } }))).toBe(true);
  });

  it("refuses an ordinary administrator, whatever scopes the connection carries", () => {
    expect(
      mayAdministerDepartments(
        client({ identity: { isSuperAdmin: false }, scopes: ["operator.admin"] }),
      ),
    ).toBe(false);
  });

  it("admits the host operator, which has no identity to rank", () => {
    expect(mayAdministerDepartments(client({ scopes: ["operator.admin"] }))).toBe(true);
    expect(mayAdministerDepartments(client({ scopes: ["operator.read"] }))).toBe(false);
    expect(mayAdministerDepartments(null)).toBe(false);
  });
});

describe("departments.agents.list", () => {
  it("refuses an ordinary administrator", async () => {
    const answer = await callMethod({
      method: "departments.agents.list",
      client: client({ identity: { isSuperAdmin: false }, scopes: ["operator.admin"] }),
    });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("FORBIDDEN");
  });

  it("projects each agent's binding and access settings", async () => {
    const answer = await callMethod({
      method: "departments.agents.list",
      client: client({ identity: { isSuperAdmin: true } }),
    });
    expect(answer.ok).toBe(true);
    // SAFETY: the assertion above proves the handler answered with its result shape.
    const result = answer.result as { agents: Record<string, unknown>[] };
    expect(result.agents.map((agent) => agent.agentId)).toEqual(["rnd-bot", "main"]);
    expect(result.agents[0]).toMatchObject({
      workspace: "/mnt/nas/rnd",
      toolsProfile: "readonly",
      permissionMode: "read-only",
      indexPaths: ["/mnt/knowledge/rnd"],
      skipBootstrap: true,
    });
  });
});

describe("departments.agents.set", () => {
  it("refuses an ordinary administrator", async () => {
    const answer = await callMethod({
      method: "departments.agents.set",
      params: { agentId: "rnd-bot", department: "rnd" },
      client: client({ identity: { isSuperAdmin: false }, scopes: ["operator.admin"] }),
    });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("FORBIDDEN");
    expect(readDepartmentAgentBindings().size).toBe(0);
  });

  it("binds and unbinds one configured agent", async () => {
    const bound = await callMethod({
      method: "departments.agents.set",
      params: { agentId: "rnd-bot", department: "RND" },
      client: client({ identity: { isSuperAdmin: true } }),
    });
    expect(bound.ok).toBe(true);
    expect(readDepartmentAgentBindings().get("rnd-bot")).toBe("rnd");

    const cleared = await callMethod({
      method: "departments.agents.set",
      params: { agentId: "rnd-bot" },
      client: client({ identity: { isSuperAdmin: true } }),
    });
    expect(cleared.ok).toBe(true);
    expect(readDepartmentAgentBindings().has("rnd-bot")).toBe(false);
  });

  it("refuses an agent that is not configured", async () => {
    const answer = await callMethod({
      method: "departments.agents.set",
      params: { agentId: "ghost-bot", department: "rnd" },
      client: client({ identity: { isSuperAdmin: true } }),
    });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("INVALID_REQUEST");
  });

  it("refuses a slug that is not a department code", async () => {
    const answer = await callMethod({
      method: "departments.agents.set",
      params: { agentId: "rnd-bot", department: "../etc" },
      client: client({ identity: { isSuperAdmin: true } }),
    });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("INVALID_REQUEST");
    expect(readDepartmentAgentBindings().size).toBe(0);
  });
});

describe("departments.folders.list", () => {
  it("refuses an ordinary administrator", async () => {
    const answer = await callMethod({
      method: "departments.folders.list",
      client: client({ identity: { isSuperAdmin: false }, scopes: ["operator.admin"] }),
    });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a path outside the shared folder root", async () => {
    const root = path.join(tempDirs.make("openclaw-departments-share-"), "nas");
    await mkdir(path.join(root, "rnd"), { recursive: true });
    vi.stubEnv("OPENCLAW_NAS_ROOT", root);
    const answer = await callMethod({
      method: "departments.folders.list",
      params: { path: "../" },
      client: client({ identity: { isSuperAdmin: true } }),
    });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("INVALID_REQUEST");
  });

  it("lists the folders under the shared root", async () => {
    const root = path.join(tempDirs.make("openclaw-departments-share-"), "nas");
    await mkdir(path.join(root, "rnd"), { recursive: true });
    await mkdir(path.join(root, "qa"), { recursive: true });
    vi.stubEnv("OPENCLAW_NAS_ROOT", root);
    const answer = await callMethod({
      method: "departments.folders.list",
      client: client({ identity: { isSuperAdmin: true } }),
    });
    expect(answer.ok).toBe(true);
    // SAFETY: the assertion above proves the handler answered with its result shape.
    const result = answer.result as { available: boolean; entries: { name: string }[] };
    expect(result.available).toBe(true);
    expect(result.entries.map((entry) => entry.name)).toEqual(["qa", "rnd"]);
  });
});
