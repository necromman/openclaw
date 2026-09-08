// Coverage for the two readers behind `openclaw audit users`.
//
// The Gateway RPC is the primary one. When it never answers - which is the normal state
// of an ix-auth deployment, where the CLI beside the Gateway has no shared secret to
// authenticate with - the same page has to come out of the state database on this host,
// in the same shape, under a line that says so.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayTransportError } from "../gateway/transport-error.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { appendUserActivityAuditEvent } from "../state/user-activity-audit-store.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  isGatewayLedgerUnavailableError,
  readLocalUserActivityPage,
} from "./audit-users-source.js";
import { auditUsersCommand } from "./audit-users.js";

const mocks = vi.hoisted(() => ({
  callGateway: vi.fn(),
  isImplicitLocalGatewayTarget: vi.fn(),
}));

vi.mock("../gateway/call.js", async () => {
  // Only the two decisions under test are faked. The failure predicates stay real, so a
  // test cannot accidentally teach the fallback to trigger on a class of error the
  // shipped code would refuse to fall back on.
  const transport = await import("../gateway/transport-error.js");
  return {
    callGateway: mocks.callGateway,
    isImplicitLocalGatewayTarget: mocks.isImplicitLocalGatewayTarget,
    isGatewayTransportError: transport.isGatewayTransportError,
    isGatewayCredentialsRequiredError: (value: unknown) =>
      value instanceof Error && value.name === "GatewayCredentialsRequiredError",
    isGatewayExplicitAuthRequiredError: (value: unknown) =>
      value instanceof Error && value.name === "GatewayExplicitAuthRequiredError",
  };
});

const CONNECTION_DETAILS = {
  url: "ws://127.0.0.1:8787",
  urlSource: "config",
  message: "gateway ws://127.0.0.1:8787",
};

/** What an ix-auth container actually gets: the handshake refused, the socket closed. */
function gatewayAuthRefused(): GatewayTransportError {
  return new GatewayTransportError({
    kind: "closed",
    message: "gateway closed (4401): gateway_auth_required",
    connectionDetails: CONNECTION_DETAILS,
    code: 4401,
    reason: "gateway_auth_required",
  });
}

function credentialsRequired(): Error {
  const error = new Error("gateway audit.userActivity.list requires credentials");
  error.name = "GatewayCredentialsRequiredError";
  return error;
}

function fakeRuntime() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    runtime: {
      log: (...args: unknown[]) => out.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => err.push(args.map(String).join(" ")),
      exit: () => {
        throw new Error("unexpected exit");
      },
    },
  };
}

function appendRow(params: {
  at: number;
  email: string;
  kind?: "login" | "prompt" | "tool_read";
  departments?: string[];
  agentId?: string;
}) {
  appendUserActivityAuditEvent({
    at: params.at,
    kind: params.kind ?? "login",
    actor: {
      source: "profile",
      profileId: `profile-${params.email}`,
      email: params.email,
      displayName: params.email,
      gatewayRole: "member",
      departments: params.departments ?? [],
    },
    ...(params.agentId ? { agentId: params.agentId } : {}),
    detail: { reason: `row-${params.at}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isImplicitLocalGatewayTarget.mockResolvedValue(true);
});

afterEach(() => closeOpenClawAgentDatabasesForTest());

describe("audit users fallback decision", () => {
  it("treats an unanswered gateway as unavailable", () => {
    expect(isGatewayLedgerUnavailableError(gatewayAuthRefused())).toBe(true);
    expect(isGatewayLedgerUnavailableError(credentialsRequired())).toBe(true);
    expect(
      isGatewayLedgerUnavailableError(
        new GatewayTransportError({
          kind: "timeout",
          message: "gateway timeout after 20000ms",
          connectionDetails: CONNECTION_DETAILS,
          timeoutMs: 20_000,
        }),
      ),
    ).toBe(true);
  });

  it("treats a refused handshake as unanswered", () => {
    // The ix-auth container case: the connect frame is rejected, so no handler ran.
    const refused = Object.assign(new Error("unauthorized"), {
      name: "GatewayClientRequestError",
      details: { code: "AUTH_REQUIRED", authReason: "gateway_auth_required" },
    });
    expect(isGatewayLedgerUnavailableError(refused)).toBe(true);
  });

  it("does not mistake a method rejection for a refused handshake", () => {
    const denied = Object.assign(new Error("forbidden"), {
      name: "GatewayClientRequestError",
      details: { code: "FORBIDDEN" },
    });
    expect(isGatewayLedgerUnavailableError(denied)).toBe(false);
  });

  it("keeps an answered rejection an answer", () => {
    // A handler that said no has decided. Reading around that decision locally would turn
    // an authorization answer into an authorization bypass.
    const forbidden = new Error("This account cannot read the activity ledger.");
    forbidden.name = "GatewayClientRequestError";
    Object.assign(forbidden, { gatewayCode: "FORBIDDEN", retryable: false });
    expect(isGatewayLedgerUnavailableError(forbidden)).toBe(false);
    expect(isGatewayLedgerUnavailableError(new Error("boom"))).toBe(false);
  });
});

describe("openclaw audit users", () => {
  it("uses the gateway page when the rpc answers", async () => {
    const { out, err, runtime } = fakeRuntime();
    mocks.callGateway.mockResolvedValue({
      events: [
        {
          sequence: 1,
          at: 1_700_000_000_000,
          kind: "login",
          actorSource: "profile",
          email: "kim@example.com",
          departments: [],
          detail: {},
        },
      ],
    });
    await auditUsersCommand({}, runtime);
    expect(mocks.callGateway).toHaveBeenCalledTimes(1);
    expect(out[0]).toContain("TIME\tKIND");
    expect(out.join("\n")).not.toContain("Local read:");
    expect(err).toEqual([]);
  });

  it("reads the local ledger and says so when the gateway refuses the handshake", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      appendRow({ at: 1_000, email: "kim@example.com" });
      appendRow({ at: 2_000, email: "lee@example.com", kind: "prompt" });
      const { out, err, runtime } = fakeRuntime();
      mocks.callGateway.mockRejectedValue(gatewayAuthRefused());
      await auditUsersCommand({}, runtime);
      expect(out[0]).toContain("Local read:");
      expect(out[0]).toContain("gateway_auth_required");
      expect(out[0]).toContain("not narrowed by department");
      expect(out[1]).toContain("TIME\tKIND");
      // Newest first, and both people are visible: a host read is not department-scoped.
      expect(out[2]).toContain("lee@example.com");
      expect(out[3]).toContain("kim@example.com");
      expect(err).toEqual([]);
    });
  });

  it("keeps every filter working on the local path", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      appendRow({ at: 1_000, email: "kim@example.com", kind: "login" });
      appendRow({ at: 2_000, email: "kim@example.com", kind: "prompt", agentId: "rnd-bot" });
      appendRow({ at: 3_000, email: "lee@example.com", kind: "prompt", agentId: "rnd-bot" });
      appendRow({ at: 9_000, email: "kim@example.com", kind: "prompt", agentId: "rnd-bot" });

      const byPerson = readLocalUserActivityPage({ email: "kim@example.com", limit: 50 });
      expect(byPerson.events.map((event) => event.at)).toEqual([9_000, 2_000, 1_000]);

      const byKind = readLocalUserActivityPage({ kind: "prompt", limit: 50 });
      expect(byKind.events.map((event) => event.at)).toEqual([9_000, 3_000, 2_000]);

      const byWindow = readLocalUserActivityPage({ from: 2_000, to: 3_000, limit: 50 });
      expect(byWindow.events.map((event) => event.at)).toEqual([3_000, 2_000]);

      const byAgent = readLocalUserActivityPage({ agentId: "rnd-bot", limit: 50 });
      expect(byAgent.events.map((event) => event.at)).toEqual([9_000, 3_000, 2_000]);

      const firstPage = readLocalUserActivityPage({ limit: 2 });
      expect(firstPage.events.map((event) => event.at)).toEqual([9_000, 3_000]);
      expect(firstPage.nextCursor).toBeDefined();
      const secondPage = readLocalUserActivityPage({
        limit: 2,
        ...(firstPage.nextCursor ? { cursor: firstPage.nextCursor } : {}),
      });
      expect(secondPage.events.map((event) => event.at)).toEqual([2_000, 1_000]);
    });
  });

  it("emits the same json page from both readers", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      appendRow({ at: 4_000, email: "kim@example.com", kind: "tool_read", agentId: "rnd-bot" });
      const local = fakeRuntime();
      mocks.callGateway.mockRejectedValue(gatewayAuthRefused());
      await auditUsersCommand({ json: true }, local.runtime);
      // The notice never lands on stdout, so a `--json` consumer parses one clean page.
      expect(local.out).toHaveLength(1);
      expect(local.err[0]).toContain("Local read:");
      const page = JSON.parse(local.out[0] ?? "{}") as {
        events: Array<Record<string, unknown>>;
      };
      // The local reader emits the protocol event shape, not the stored row shape.
      expect(Object.keys(page.events[0] ?? {}).toSorted()).toEqual(
        [
          "actorSource",
          "agentId",
          "at",
          "departments",
          "detail",
          "displayName",
          "email",
          "gatewayRole",
          "kind",
          "profileId",
          "sequence",
        ].toSorted(),
      );

      const remote = fakeRuntime();
      mocks.callGateway.mockReset();
      mocks.callGateway.mockResolvedValue(page);
      await auditUsersCommand({ json: true }, remote.runtime);
      expect(remote.out).toEqual(local.out);
      expect(remote.err).toEqual([]);
    });
  });

  it("rethrows instead of reading a database that is not that gateway's", async () => {
    // Remote mode or an explicit `--url` names another host. Its ledger is not this
    // filesystem, so a local answer there would be a wrong answer, not a fallback.
    mocks.isImplicitLocalGatewayTarget.mockResolvedValue(false);
    mocks.callGateway.mockRejectedValue(gatewayAuthRefused());
    const { runtime } = fakeRuntime();
    await expect(auditUsersCommand({}, runtime)).rejects.toThrow("gateway_auth_required");
  });

  it("rethrows an answered rejection untouched", async () => {
    const forbidden = new Error("This account cannot read the activity ledger.");
    forbidden.name = "GatewayClientRequestError";
    Object.assign(forbidden, { gatewayCode: "FORBIDDEN", retryable: false });
    mocks.callGateway.mockRejectedValue(forbidden);
    const { runtime } = fakeRuntime();
    await expect(auditUsersCommand({}, runtime)).rejects.toThrow(
      "This account cannot read the activity ledger.",
    );
  });
});
