import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { RuntimeEnv } from "../runtime.js";
import { readDepartmentAgentBindings, setDepartmentAgent } from "../state/departments-store.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";

const config: { value: OpenClawConfig } = { value: {} as OpenClawConfig };

vi.mock("./config-validation.js", () => ({
  requireValidConfig: async () => config.value,
}));

const { agentsDepartmentCommand } = await import("./agents.commands.department.js");

afterEach(() => closeOpenClawAgentDatabasesForTest());

function recordingRuntime(): RuntimeEnv & { out: string[]; errors: string[]; codes: number[] } {
  const out: string[] = [];
  const errors: string[] = [];
  const codes: number[] = [];
  return {
    log: (line: string) => out.push(line),
    error: (line: string) => errors.push(line),
    exit: (code: number) => {
      codes.push(code);
    },
    out,
    errors,
    codes,
  } as RuntimeEnv & { out: string[]; errors: string[]; codes: number[] };
}

function withAgents(ids: string[]): void {
  config.value = {
    agents: { entries: Object.fromEntries(ids.map((id) => [id, {}])) },
  } as unknown as OpenClawConfig;
}

describe("openclaw agents department", () => {
  it("clears a binding whose agent the config no longer names", async () => {
    // The order this exists for: an agent is dropped from the delivery template, and its
    // row is left behind. Refusing to clear it would leave no way to remove the row short
    // of opening the database, and an agent later created with the same id would silently
    // inherit the old department.
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      withAgents(["main", "rnd-bot"]);
      setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "rnd", nowMs: Date.now() });
      withAgents(["main"]);

      const runtime = recordingRuntime();
      await agentsDepartmentCommand({ agent: "rnd-bot", clear: true }, runtime);

      expect(runtime.errors).toEqual([]);
      expect(runtime.codes).toEqual([]);
      expect(readDepartmentAgentBindings().has("rnd-bot")).toBe(false);
    });
  });

  it("still refuses to bind an agent the config does not name", async () => {
    // Binding is the other direction: it would look done and do nothing.
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      withAgents(["main"]);
      const runtime = recordingRuntime();
      await agentsDepartmentCommand({ agent: "ghost-bot", set: "rnd" }, runtime);

      expect(runtime.errors.join("\n")).toContain('unknown agent "ghost-bot"');
      expect(runtime.codes).toEqual([1]);
      expect(readDepartmentAgentBindings().has("ghost-bot")).toBe(false);
    });
  });

  it("reports a left-behind row instead of hiding it", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      withAgents(["main", "qa-bot"]);
      setDepartmentAgent({ agentId: "qa-bot", departmentSlug: "qa", nowMs: Date.now() });
      withAgents(["main"]);

      const runtime = recordingRuntime();
      await agentsDepartmentCommand({}, runtime);

      expect(runtime.out.join("\n")).toContain("qa-bot");
    });
  });
});
