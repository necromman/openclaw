import { afterEach, describe, expect, it } from "vitest";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  clearDepartmentAgent,
  listDepartmentMembers,
  listDepartments,
  listDepartmentsForProfile,
  normalizeDepartmentSlug,
  readDepartmentAgentBindings,
  setDepartmentAgent,
  syncDepartmentMembership,
  upsertDepartment,
} from "./departments-store.js";
import { closeOpenClawAgentDatabasesForTest } from "./openclaw-agent-db.js";

afterEach(() => closeOpenClawAgentDatabasesForTest());

describe("departments store", () => {
  it("normalizes codes to lower-case slugs", () => {
    expect(normalizeDepartmentSlug("  RnD  ")).toBe("rnd");
  });

  it("creates a department on first sight and keeps an authored name", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      upsertDepartment({ slug: "rnd", displayName: "Research", nowMs: 10 });
      expect(listDepartments()).toEqual([
        { slug: "rnd", display_name: "Research", created_at: 10, updated_at: 10 },
      ]);
      syncDepartmentMembership({ profileId: "p1", departments: ["rnd"], nowMs: 20 });
      // A projected login must not downgrade an operator-authored name to the bare slug.
      expect(listDepartments()[0]?.display_name).toBe("Research");
    });
  });

  it("projects membership and revokes what the claim no longer carries", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      syncDepartmentMembership({ profileId: "p1", departments: ["rnd", "qa"], nowMs: 1 });
      expect(listDepartmentsForProfile("p1")).toEqual(["qa", "rnd"]);
      syncDepartmentMembership({ profileId: "p1", departments: ["qa"], nowMs: 2 });
      expect(listDepartmentsForProfile("p1")).toEqual(["qa"]);
      syncDepartmentMembership({ profileId: "p1", departments: [], nowMs: 3 });
      expect(listDepartmentsForProfile("p1")).toEqual([]);
      // The department itself survives so an agent binding to it stays meaningful.
      expect(listDepartments().map((row) => row.slug)).toEqual(["qa", "rnd"]);
    });
  });

  it("keeps one person's revocation from touching another", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      syncDepartmentMembership({ profileId: "p1", departments: ["rnd"], nowMs: 1 });
      syncDepartmentMembership({ profileId: "p2", departments: ["rnd"], nowMs: 1 });
      syncDepartmentMembership({ profileId: "p1", departments: [], nowMs: 2 });
      expect(listDepartmentMembers("rnd")).toEqual(["p2"]);
    });
  });

  it("binds one agent to one department and replaces on rebind", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "RND", nowMs: 1 });
      expect(readDepartmentAgentBindings().get("rnd-bot")).toBe("rnd");
      setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "qa", nowMs: 2 });
      expect(readDepartmentAgentBindings().get("rnd-bot")).toBe("qa");
      clearDepartmentAgent("rnd-bot");
      expect(readDepartmentAgentBindings().has("rnd-bot")).toBe(false);
    });
  });

  it("registers the department named by a binding so it can be listed", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setDepartmentAgent({ agentId: "qa-bot", departmentSlug: "qa", nowMs: 5 });
      expect(listDepartments().map((row) => row.slug)).toEqual(["qa"]);
    });
  });
});
