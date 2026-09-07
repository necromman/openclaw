// Real-parser coverage for `openclaw audit` and its `users` subcommand.
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAuditCommand } from "./register.audit.js";

const mocks = vi.hoisted(() => ({
  auditListCommand: vi.fn(),
  auditUsersCommand: vi.fn(),
  runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
}));

vi.mock("../../commands/audit.js", () => ({ auditListCommand: mocks.auditListCommand }));

vi.mock("../../commands/audit-users.js", () => ({ auditUsersCommand: mocks.auditUsersCommand }));

vi.mock("../../runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../runtime.js")>()),
  defaultRuntime: mocks.runtime,
}));

async function runCli(args: string[]) {
  const program = new Command();
  registerAuditCommand(program);
  await program.parseAsync(args, { from: "user" });
}

function firstOptions(command: { mock: { calls: unknown[][] } }) {
  expect(command.mock.calls).toHaveLength(1);
  return command.mock.calls[0]?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auditListCommand.mockResolvedValue(undefined);
  mocks.auditUsersCommand.mockResolvedValue(undefined);
});

describe("openclaw audit", () => {
  it("still routes the bare command to the metadata ledger", async () => {
    await runCli(["audit", "--agent", "main", "--json"]);
    expect(mocks.auditUsersCommand).not.toHaveBeenCalled();
    expect(firstOptions(mocks.auditListCommand)).toMatchObject({ agentId: "main", json: true });
  });

  it("routes the users subcommand to the activity ledger", async () => {
    await runCli([
      "audit",
      "users",
      "--email",
      "kim@example.com",
      "--profile",
      "p1",
      "--kind",
      "tool_read",
      "--agent",
      "rnd-bot",
      "--session",
      "agent:main",
      "--since",
      "2026-09-01",
      "--until",
      "2026-09-08",
      "--limit",
      "50",
      "--json",
    ]);
    expect(mocks.auditListCommand).not.toHaveBeenCalled();
    expect(firstOptions(mocks.auditUsersCommand)).toEqual({
      email: "kim@example.com",
      profileId: "p1",
      kind: "tool_read",
      agentId: "rnd-bot",
      sessionKey: "agent:main",
      since: "2026-09-01",
      until: "2026-09-08",
      cursor: undefined,
      limit: "50",
      json: true,
    });
  });

  it("accepts shared flags placed before the subcommand", async () => {
    // `--agent`, `--kind` and `--json` exist on both commands, so commander can bind
    // them to the parent depending on where they sit on the line.
    await runCli(["audit", "--agent", "rnd-bot", "--kind", "tool_read", "--json", "users"]);
    expect(mocks.auditListCommand).not.toHaveBeenCalled();
    expect(firstOptions(mocks.auditUsersCommand)).toMatchObject({
      agentId: "rnd-bot",
      kind: "tool_read",
      json: true,
    });
  });

  it("drops a kind this build does not know rather than forwarding it", async () => {
    await runCli(["audit", "users", "--kind", "not-a-kind"]);
    expect(firstOptions(mocks.auditUsersCommand).kind).toBeUndefined();
  });
});
